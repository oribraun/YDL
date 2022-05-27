"use strict";

var express = require('express');
var session = require('express-session');
var cors = require('cors');
var archiver = require('archiver');
var path = require('path');
var fs = require('fs-extra');
var rimraf = require("rimraf");
const execFile = require('child_process').execFile;
const spawn = require('child_process').spawn;
const exec = require('child_process').exec;
var app = express();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var CronJob = require('cron').CronJob;
var isWin = process.platform === "win32";
var port = process.env.PORT || 4000;
// var youtube_dl = isWin ? '/windows/youtube-dl.exe' : '/linux/youtube-dl';
var youtube_dl = isWin ? '/windows/yt-dlp.exe' : '/linux/yt-dlp';
var ffmpeg = isWin ? '/windows/ffmpeg.exe' : '/linux/ffmpeg';
var downloadDir = '/tmp/';

const debug = true;
if (debug) {
    var util = require('util');
    var log_file = fs.createWriteStream(__dirname + '/debug.log', {flags: 'w'});
    var log_stdout = process.stdout;

    console.log = function (n, l) { //
        log_file.write(util.format(n) + ' ' + (l ? util.format(l) : '') + '\n');
        log_stdout.write(util.format(n) + ' ' + (l ? util.format(l) : '') + '\n');
    };
}

app.set('trust proxy', 1);
app.use(session({
    secret: 'keyboard cat',
    resave: false,
    saveUninitialized: false ,
    cookie: { secure: false, maxAge: 1000*60*60*24 }
}))
app.use(cors());
http.listen(port, function() {
    console.log('Server Works !!! At port ' + port);
});
app.use("/lists", express.static(__dirname + '/lists'));
app.use("/file", express.static(__dirname + '/file'));
app.use("/dist", express.static(__dirname + '/dist'));


var sockets = {};
var usersCount = 0;
io.on('connection', function(socket){
    console.log('a user connected - ' + socket.id);
    socket.emit('set-socket-id', socket.id);
    sockets[socket.id] = {};
    socket.on('disconnect', function(){
        const sess = sockets[socket.id].sess;
        stopProcess(sess);
        delete sockets[socket.id];
        console.log('user disconnected');
    });
});

app.get('/download-playlist', function(req,res) {
    // playlist('https://www.youtube.com/playlist?list=PLJ4dTHPAykBmiARyN7lkBjIlyYR2njnP_');
    // playlist('https://www.youtube.com/playlist?list=PLEFA9E9D96CB7F807');

    var protocol = req.connection.encrypted ? 'https://' : 'http://';
    var host = req.headers.host; // server domain
    var origin = req.headers.origin; // local domain
    var socketId = req.query.sId;
    var URL = req.query.URL;
    var TYPE = req.query.TYPE;
    if (!socketId) {
        res.json({err: 'unauthorized user'});
        return;
    }
    if(!sockets[socketId].sess) {
        sockets[socketId].sess = req.session;
    }
    const sess = sockets[socketId].sess;
    console.log('download-playlist1');
    sess.count = 1;
    var count = sess.count;
    var total;
    var listId = URL.split("list=")[1];
    var folder =  sess.id + socketId + (listId ? '-' + listId : '');
    var dir = downloadDir + folder;
    var zipDest = '/lists';
    var fileDest = '/file';
    console.log('dir', dir);
    createDownloadDir(downloadDir, dir);
    if(sess.proc) {
        try {
            stopProcess(sess);
        } catch(e) {
            console.log('error canceling proc_id', e);
        }
    }
    console.log("********************************************************************")
    // getting file data
    var args = getNoDownloadListArgs(URL);
    const TEN_MEGABYTES = 1000 * 1000 * 10;
    const options = {};
    const execFileOpts = { encoding: 'utf8' ,maxBuffer: TEN_MEGABYTES };

    // console.log(__dirname + youtube_dl + ' ' + args.join(' '))
    var proc = spawn(__dirname + youtube_dl, args, { execFileOpts, options }, function done(err, stdout, stderr) {
        if (err) {
            console.error('Error:', err.stack);
            try {
                proc.kill('SIGINT');
                removeDir(sess.dir);
                // fs.removeSync(path.join(__dirname, sess.dir));
                delete sess.proc;
                delete sess.dir;
            } catch(e) {
                console.log('e', e);
            }
            // throw err;
        }
        // console.log('Success', stdout);
        // console.log('Err', stderr);
    });
    proc.stdout.setEncoding('utf8');
    sess.proc = proc;
    sess.dir = dir;
    sess.playlistMap = {};
    // console.log("sess.proc.pid before", sess.proc.pid)

    proc.stderr.on('data', function(data) {
        console.log('err', data.toString('utf8'));
        // process.stderr.write(data);
    });
    proc.stdout.on('data', function(data) {
        var data = JSON.parse(data);
        // console.log('data1', data);
        let playlist_index = data.playlist_index;
        let n_entries = data.n_entries;
        if (playlist_index === null) {
            playlist_index = 1;
        }
        if (n_entries === null || n_entries === undefined) {
            n_entries = 1;
        }
        console.log('playlist_index', playlist_index)
        console.log('n_entries', n_entries)
        var progress = Math.ceil((playlist_index / n_entries * 100));
        total = n_entries;
        console.log('progress', progress);
        // console.log('data', data);
        console.log('data.n_entries', n_entries);
        console.log('data.webpage_url', data.webpage_url);
        console.log('data.playlist_index', data.playlist_index);
        if(!progress) {
            progress = 100;
        }
        sess.playlistMap[playlist_index] = data.title;
        io.to(socketId).emit('progress', progress, data.webpage_url, data.thumbnail, data.title, data.description, playlist_index);
        // process.stdout.write(data);
    });
    proc.on('close', function(code, signal) {
        console.log('code', code);
        console.log('signal', signal);
        console.log('spawn closed');
        delete sess.proc;
        if(!signal && !code) {
            downloadList(socketId);
        }
        if(code) {
            io.to(socketId).emit('failed', 'process failed');
        }
    });

    function downloadList(socketId) {
        const sess = sockets[socketId].sess;
        console.log('start-downloading-list');
        var args = getDownloadListArgs(TYPE, URL, ffmpeg, dir);
        const TEN_MEGABYTES = 1000 * 1000 * 10;
        const options = {};
        const execFileOpts = { encoding: 'utf8' ,maxBuffer: TEN_MEGABYTES };
        sess.count = 0;
        // var count = sess.count;
        var current_video_index = 1;
        var current_temp_file_name = sess.playlistMap[current_video_index];
        // var failedFiles = [];
        sess.successCount = 0;
        sess.failedFilesMap = {};
        const p =spawn(__dirname + youtube_dl, ['--rm-cache-dir']);
        // p.stderr.on('data', function(data) {
        //     console.log('err', data.toString('utf8'));
        // })
        // p.stdout.on('data', function(data) {
        //     console.log('data', data.toString('utf8'));
        // })
        var proc = spawn(__dirname + youtube_dl, args, { execFileOpts, options }, function done(err, stdout, stderr) {
            if (err) {
                console.error('Error:', err.stack);
                console.log('proc.pid', proc.pid);
                try {
                    proc.kill('SIGINT');
                    removeDir(sess.dir);
                    // fs.removeSync(path.join(__dirname, sess.dir));
                    delete sess.proc;
                    delete sess.dir;
                } catch(e) {
                    console.log('e', e);
                }
                // throw err;
            }
            // console.log('Success', stdout);
            // console.log('Err', stderr);
        });
        // console.log("sess.proc.pid before", sess.proc.pid)
        proc.stdout.setEncoding('utf8');
        sess.proc = proc;
        // console.log("sess.proc.pid after", sess.proc.pid)

        proc.stderr.on('data', function(data) {
            const err = data.toString('utf8');
            const typeError = err.indexOf('ERROR:') > -1;
            const typeWarning = err.indexOf('WARNING:') > -1;
            if (typeWarning) {
                console.log('err', err)
            } else if(typeError) {
                if (current_video_index) {
                    console.log('err item-failed', err);
                    console.log('err item-failed', current_video_index);
                    // failedFiles.push(current_temp_file_name);
                    sess.failedFilesMap[current_video_index] = {current_temp_file_name: current_temp_file_name, err: err}
                    // failedFiles.push(current_temp_file_name);
                    io.to(socketId).emit('item-failed', current_video_index);
                    // process.stderr.write(data);
                }
            }
        });
        proc.stdout.on('data', function(data) {
            const re = /[0-9]+((\.[0-9]{1}){0,1})%/i;
            const matches = data.match(re);
            if (matches && matches.length && matches.length > 0) {
                // Prints the percentage.
                console.log('matches[0]',matches[0]);
            }
            // var data = JSON.parse(data);
            if(data.indexOf('[download] Downloading video') > -1) {
                current_video_index = data.match(/(?<=\[download] Downloading video\ )\d+/g)[0];
                current_temp_file_name = sess.playlistMap[current_video_index];
                console.log('current_video_index', current_video_index)
                console.log('current_temp_file_name', current_temp_file_name)
            }
            // if(data.indexOf('[download] Destination') > -1) {
            // current_temp_file_name = data.substr(data.indexOf(folder) + folder.length + 1).trim();
            // console.log('current_temp_file_name', current_temp_file_name)
            // count++;
            // }
            if(data.indexOf('[ffmpeg] Destination') > -1) {
                console.log('converting item')
                io.to(socketId).emit('item-convert', current_video_index);
            }
            if(data.indexOf('Downloading video info webpage') > -1
                || data.indexOf('[download] Downloading video') > -1) {
                // console.log('dir', dir)
                let lastIndex = current_video_index - 1;
                if (lastIndex && !sess.failedFilesMap[lastIndex]) {
                    sess.successCount++;
                    io.to(socketId).emit('item-success', lastIndex);
                }
                // count++;
            }
            console.log('data', data);
            if(data.indexOf('%') > -1 && data.indexOf('ETA') > -1) {
                var percent = Math.ceil(data.substr(data.indexOf(' ') + 1,data.length - (data.length - data.indexOf('%') + 1) - data.indexOf(' ')))
                console.log('percent',percent)
                console.log('current_video_index',current_video_index)
                io.to(socketId).emit('item-progress', percent, current_video_index);
                // if(percent >= 100) {
                //     io.to(socketId).emit('item-success', count);
                // }
            } else {
                // waiting
            }
            // var percent = (data.playlist_index / data.n_entries * 100);
            // var percent = Math.ceil((pos / size * 100));
            // process.stdout.cursorTo(0);
            // process.stdout.clearLine(1);
            // process.stdout.write(percent + '%');
            // io.to(socketId).emit('item-progress', percent, count);
            // process.stdout.write(data);
        });
        proc.on('close', function(code, signal) {
            console.log('code', code);
            console.log('signal', signal);
            console.log('execFile closed');
            delete sess.proc;
            if (!sess.failedFilesMap[current_video_index]) {
                sess.successCount++;
                io.to(socketId).emit('item-success', current_video_index);
            }
            if(!signal) {
                delete sess.proc;
                if (Object.keys(sess.failedFilesMap).length) {
                    console.log('failedFilesMap', JSON.stringify(sess.failedFilesMap, null, 2))
                    io.to(socketId).emit('all-files-failed', sess.failedFilesMap);
                }
                // console.log('sess.successCount', sess.successCount)
                if (!sess.successCount) {
                    removeDir(dir);
                    io.to(socketId).emit('all-failed');
                    return;
                }
                // removeFailedFiles(dir, failedFiles);
                if (current_video_index > 1) {
                    createZip(dir);
                } else {
                    createFile(dir);
                }
            }
            // if(code) {
            //     io.to(socketId).emit('failed', 'process failed');
            // }
        });
    }

    function convertFilesToMp3(dir) {
        var args = [];
        var options = {};
        var command = 'FOR %G IN ("' + __dirname + dir + '/*.*") DO ' + __dirname + '/src/ffmpeg.exe' + ' -i "' + __dirname + dir + '/%~nxG" -f mp3 -ab 192000 -vn -y "' + __dirname + dir + '/%~nG.mp3"';
        var proc = exec(command, (err, stdout, stderr) => {
            if (err) {
                console.error('Error:', err.stack);
                console.log('proc.pid', proc.pid);

                try {
                    proc.kill('SIGINT');
                    removeDir(sess.dir);
                    // fs.removeSync(path.join(__dirname, sess.dir));
                    delete sess.proc;
                    delete sess.dir;
                } catch(e) {
                    console.log('e', e);
                }
                // throw err;
            } else {
                // createZip(dir);
            }
            // console.log('Success', stdout);
            // console.log('Err', stderr);
        });
        sess.proc = proc;
        proc.stderr.on('data', function(data) {
            console.log('err', data.toString('utf8'));
            // process.stderr.write(data);
        });
        proc.stdout.on('data', function(data) {
            const re = /[0-9]+((\.[0-9]{1}){0,1})%/i;
            const matches = data.match(re);
            if (matches && matches.length && matches.length > 0) {
                // Prints the percentage.
                console.log('matches[0]',matches[0]);
            }
            // var data = JSON.parse(data);
            if(data.indexOf('[download] Destination') > -1) {
                count++;
            }
            console.log('data', data);
            if(data.indexOf('%') > -1) {
                var percent = Math.ceil(data.substr(data.indexOf(' ') + 1,data.length - (data.length - data.indexOf('%') + 1) - data.indexOf(' ')))
                console.log('percent',percent)
                console.log('count',count)
                io.to(socketId).emit('item-progress', percent, count);
            } else {
                // waiting
            }
            // var percent = (data.playlist_index / data.n_entries * 100);
            // var percent = Math.ceil((pos / size * 100));
            // process.stdout.cursorTo(0);
            // process.stdout.clearLine(1);
            // process.stdout.write(percent + '%');
            // io.to(socketId).emit('item-progress', percent, count);
            // process.stdout.write(data);
        });
        proc.on('close', function(code, signal) {
            console.log('code', code);
            console.log('signal', signal);
            console.log('execFile closed');
            if(!signal && !code) {
                delete sess.proc;
                createZip(dir);
            }
            if(code) {
                io.to(socketId).emit('failed', 'process failed');
            }
        });
    }

    function createZip(dir) {
        io.to(socketId).emit('starting-zip');
        if (!fs.existsSync(__dirname + zipDest)) {
            fs.mkdirSync(__dirname + zipDest, { recursive: true });
        }
        var output = fs.createWriteStream(__dirname + zipDest + '/' + folder + '.zip');
        var archive = archiver('zip');
        output.on('close', function() {
            console.log(archive.pointer() + ' total bytes');
            console.log('archiver has been finalized and the output file descriptor has closed.');
            io.to(socketId).emit('download-url', protocol + host + zipDest + '/' + folder + '.zip');
            removeDir(dir);
            setTimeout(function(){
                removeDir(zipDest + '/' + folder + '.zip');
                // fs.removeSync(path.join(__dirname, zipDest + '/' + folder + '.zip'));
            },5000)

            //empty files
        });

        output.on('end', function() {
            console.log('Data has been drained');
        });

        archive.on('warning', function(err) {
            console.log('warning err', err);
            if (err.code === 'ENOENT') {
                // log warning
            } else {
                // throw error
                throw err;
            }
        });

        archive.on('error', function(err) {
            console.log('error err', err);
            throw err;
        });

        archive.on('progress', function(data) {
            var entries = data.entries;
            var entriesTotal = data.entries.total;
            var entriesProcessed = data.entries.processed;
            var progress = Math.ceil((data.fs.processedBytes / data.fs.totalBytes * 100));
            io.to(socketId).emit('zip-progress', progress);
        });

        archive.on('end', function(){
            io.to(socketId).emit('zip-end');
        })

        archive.pipe(output);

        // archive.glob(dir + '/*.' + TYPE, { cwd: '' });
        archive.glob('*.' + TYPE, { cwd: __dirname + dir }, { prefix: ''} );
        archive.finalize();
    }
    function createFile(dir) {
        if (!fs.existsSync(__dirname + fileDest)) {
            fs.mkdirSync(__dirname + fileDest, { recursive: true });
        }
        const files = fs.readdirSync(__dirname + dir)
        const file = files[0];
        var output = fs.createReadStream(__dirname + dir + '/' + file).pipe(fs.createWriteStream(__dirname + fileDest + '/' + file));
        output.on('close', function() {
            io.to(socketId).emit('download-url', protocol + host + fileDest + '/' + file);
            removeDir(dir);
            setTimeout(function () {
                //TODO fix corrupted files
                removeDir(fileDest + '/' + file);
                // fs.removeSync(path.join(__dirname, fileDest + '/' + file));
            }, 5000)
        });
        output.on('end', function() {
            console.log('Data has been drained');
        });
    }

    function removeFailedFiles(dir, failedFiles) {
        if(failedFiles.length) {
            if (fs.existsSync(__dirname + dir)) {
                fs.readdir(__dirname + dir, (err, files) => {
                    files.forEach(file => {
                        for(var i in failedFiles) {
                            if (file.includes(failedFiles[i].trim())) {
                                console.log('deleting file', file)
                                fs.unlink(__dirname + dir + '/' + file);
                            }
                        }
                    })
                })
            }
        }
    }

    res.json({});
});

app.get('/download-item', function(req,res) {
    var protocol = req.connection.encrypted ? 'https://' : 'http://';
    var host = req.headers.host; // server domain
    var origin = req.headers.origin; // local domain
    var socketId = req.query.sId;
    var URL = req.query.URL;
    var TYPE = req.query.TYPE;
    if (!socketId) {
        res.json({err: 'unauthorized user'});
        return;
    }
    if(!sockets[socketId].sess) {
        sockets[socketId].sess = req.session;
    }
    const sess = sockets[socketId].sess;
    console.log('download-item');
    var folder =  sess.id + socketId;
    var dir = downloadDir + folder;
    var zipDest = '/lists';
    var fileDest = '/file';
    console.log('dir', dir);
    createDownloadDir(downloadDir, dir);
    if(sess.proc) {
        res.send({err: 1, errorMessage: 'download in progress'})
        return;
    }
    console.log("********************************************************************")
    var args = getDownloadListArgs(TYPE, URL, ffmpeg, dir);
    const TEN_MEGABYTES = 1000 * 1000 * 10;
    const options = {};
    const execFileOpts = { encoding: 'utf8' ,maxBuffer: TEN_MEGABYTES };
    const p =spawn(__dirname + youtube_dl, ['--rm-cache-dir']);
    var proc = spawn(__dirname + youtube_dl, args, { execFileOpts, options }, function done(err, stdout, stderr) {
        if (err) {
            console.error('Error:', err.stack);
            console.log('proc.pid', proc.pid);
            try {
                proc.kill('SIGINT');
                removeDir(dir);
            } catch(e) {
                console.log('e', e);
            }
        }
    });
    sess.proc = proc;
    proc.stdout.setEncoding('utf8');

    proc.stderr.on('data', function(data) {
        const err = data.toString('utf8');
        const typeError = err.indexOf('ERROR:') > -1;
        const typeWarning = err.indexOf('WARNING:') > -1;
        if (typeWarning) {
            console.log('err', err)
        } else if(typeError) {
            delete sess.proc;
            res.send({err: 1, errorMessage: err});
        }
    });
    proc.stdout.on('data', function(data) {
        const re = /[0-9]+((\.[0-9]{1}){0,1})%/i;
        const matches = data.match(re);
        if (matches && matches.length && matches.length > 0) {
            // Prints the percentage.
            console.log('matches[0]',matches[0]);
        }
        console.log('data', data);
    });
    proc.on('close', function(code, signal) {
        console.log('code', code);
        console.log('signal', signal);
        console.log('execFile closed');
        delete sess.proc;
        if(!signal) {
            if (!fs.existsSync(__dirname + fileDest)) {
                fs.mkdirSync(__dirname + fileDest, { recursive: true });
            }
            const files = fs.readdirSync(__dirname + dir)
            const file = files[0];
            var output = fs.createReadStream(__dirname + dir + '/' + file).pipe(fs.createWriteStream(__dirname + fileDest + '/' + file));
            output.on('close', function() {
                const Buffer = require('buffer');
                let buffer = fs.readFileSync(__dirname + fileDest + '/' + file);
                // console.log('buffer', buffer)
                let arraybuffer = Uint8Array.from(buffer).buffer;
                // console.log('arraybuffer', arraybuffer)
                res.send({fileName: file, blob: Buffer.Buffer.from(arraybuffer)})
                removeDir(dir);
                setTimeout(function () {
                    //TODO fix corrupted files
                    removeDir(fileDest + '/' + file);
                    // fs.removeSync(path.join(__dirname, fileDest + '/' + file));
                }, 5000)
            });
            output.on('end', function() {
                console.log('Data has been drained');
            });
        }
    });
})

app.get('/*', function(req, res) {
    res.sendFile(__dirname + '/dist/index.html');
})
function startCron() {
    var downloadFolder = __dirname + downloadDir;
    var zipFolder = __dirname + '/lists/';
    new CronJob('0 0 * * *', function() {
        if (fs.existsSync(downloadFolder)) {
            fs.readdir(downloadFolder, (err, files) => {
                files.forEach(file => {
                    fs.stat(downloadFolder + file, function(err, stats){
                        let seconds = Math.ceil((new Date().getTime() - stats.mtime) / 1000);
                        var days = Math.floor(seconds / (3600*24));
                        seconds  -= days*3600*24;
                        var hrs   = Math.floor(seconds / 3600);
                        seconds  -= hrs*3600;
                        var mnts = Math.floor(seconds / 60);
                        seconds  -= mnts*60;
                        // console.log(days+" days, "+hrs+" Hrs, "+mnts+" Minutes, "+seconds+" Seconds");
                        // console.log(`File modified ${seconds} seconds ago`);
                        if(days > 2) {
                            fs.removeSync(downloadFolder + file);
                        }
                    });
                });
            });
        }
        if (fs.existsSync(zipFolder)) {
            fs.readdir(zipFolder, (err, files) => {
                files.forEach(file => {
                    fs.stat(zipFolder + file, function(err, stats){
                        let seconds = Math.ceil((new Date().getTime() - stats.mtime) / 1000);
                        var days = Math.floor(seconds / (3600*24));
                        seconds  -= days*3600*24;
                        var hrs   = Math.floor(seconds / 3600);
                        seconds  -= hrs*3600;
                        var mnts = Math.floor(seconds / 60);
                        seconds  -= mnts*60;
                        // console.log(days+" days, "+hrs+" Hrs, "+mnts+" Minutes, "+seconds+" Seconds");
                        // console.log(`File modified ${seconds} seconds ago`);
                        if(days > 2) {
                            fs.removeSync(zipFolder + file);
                        }
                    });
                });
            });
        }
    }, null, true, 'America/Los_Angeles');
}
startCron();

function removeDir(dir) {
    // console.log('path.join(__dirname, dir)', path.join(__dirname, dir))
    // fs.removeSync(path.join(__dirname, dir));
    rimraf(path.join(__dirname, dir), function () {
        // console.log("done");
    });
    // fs.unlinkSync(path.join(__dirname, dir));
}

function createDownloadDir(downloadDir, dir) {
    if (!fs.existsSync(__dirname + downloadDir)) {
        fs.mkdirSync(__dirname + downloadDir, { recursive: true });
        fs.chmodSync(__dirname + downloadDir, 777)
    }
    if (!fs.existsSync(__dirname + dir)) {
        fs.mkdirSync(__dirname + dir, { recursive: true });
        fs.chmodSync(__dirname + dir, 777)
    }
}

function getNoDownloadListArgs(URL) {
    var args = [];
    // args.push('--get-thumbnail');
    // args.push('--get-description');
    // args.push('--get-duration');
    // args.push('--get-title');
    // args.push('--get-filename');
    args.push('--skip-download');
    args.push('--dump-json');
    args.push(URL);

    return args;
}

function getDownloadListArgs(TYPE, URL, ffmpeg, dir) {
    var args = [];
    console.log('__dirname + ffmpeg', __dirname + ffmpeg)
    if(TYPE === 'mp3') {
        // yt-dlp.exe --ignore-errors --format bestaudio --extract-audio --audio-format mp3 --audio-quality 160K --output "%(title)s.%(ext)s" --yes-playlist https://www.youtube.com/playlist?list=PL3-sRm8xAzY-556lOpSGH6wVzyofoGpzU
        // args.push('--ignore-errors');
        args.push('--ignore-errors');
        args.push('--format');
        args.push('bestaudio/best');
        args.push('--extract-audio');
        args.push('--audio-quality');
        args.push('5');
        args.push('--audio-format');
        args.push('mp3');
        args.push('--ffmpeg-location');
        args.push(__dirname + ffmpeg);
        args.push('--output');
        // args.push(dir + '/%(title)s.' + TYPE);
        args.push(__dirname + dir + '/%(title)s.%(ext)s');

        // args.push('-i');
        // args.push('-f');
        // args.push('best');
        // args.push('--recode-video');
        // args.push('mp4');
        // args.push('--encoding');
        // args.push('utf8');
        // args.push('-o');
        //
        // args.push(dir + '/%(title)s.%(ext)s');
    }
    if(TYPE === 'mp4') {
        // args.push('-f');
        // args.push('bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4');
        // args.push('--audio-quality');
        // args.push('0');
        args.push('--ignore-errors');
        args.push('--format');
        args.push('best');
        args.push('--recode-video');
        args.push('mp4');
        args.push('--encoding');
        args.push('utf8');
        args.push('--output');
        args.push(__dirname + dir + '/%(title)s.' + TYPE);
    }

    args.push(URL);

    return args;
}

function stopProcess(sess) {
    if (sess) {
        console.log('sess', sess)
        if (sess.proc) {
            sess.proc.kill('SIGINT');
        }
        if (sess.dir) {
            console.log('__dirname + sess.dir', path.join(__dirname, sess.dir))
            removeDir(sess.dir);
        }
        // fs.removeSync(path.join(__dirname, sess.dir));
        if (sess.proc) {
            delete sess.proc;
        }
        if (sess.dir) {
            delete sess.dir;
        }
    }
}
