"use strict";

var express = require('express');
var session = require('express-session');
var cors = require('cors');
var archiver = require('archiver');
var fs = require('fs-extra');
const execFile = require('child_process').execFile;
const spawn = require('child_process').spawn;
const exec = require('child_process').exec;
var app = express();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var CronJob = require('cron').CronJob;
var isWin = process.platform === "win32";
var port = process.env.PORT || 4000;
var youtube_dl = isWin ? '/windows/youtube-dl.exe' : '/linux/youtube-dl';
var ffmpeg = isWin ? '/windows/ffmpeg.exe' : '/linux/ffmpeg';
var downloadDir = '/../tmp/';


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
app.use("/dist", express.static(__dirname + '/dist'));


var sockets = [];
var sess;

io.on('connection', function(socket){
    console.log('a user connected - ' + socket.id);
    sockets.push(socket.id);
    socket.emit('set-index', sockets.length - 1);
    socket.on('disconnect', function(){
        console.log('user disconnected');
    });
});

app.get('/download-playlist', function(req,res) {
    // playlist('https://www.youtube.com/playlist?list=PLJ4dTHPAykBmiARyN7lkBjIlyYR2njnP_');
    // playlist('https://www.youtube.com/playlist?list=PLEFA9E9D96CB7F807');

    var protocol = req.connection.encrypted ? 'https://' : 'http://';
    var host = req.headers.host; // server domain
    var origin = req.headers.origin; // local domain
    if(!sess) {
        sess = req.session;
    }
    console.log('download-playlist1')
    var URL = req.query.URL;
    var TYPE = req.query.TYPE;
    var socketIndex = req.query.sIndex;
    var count = 1;
    var total;
    var listId = URL.split("list=")[1];
    var folder =  sess.id + (listId ? '-' + listId : '');
    var dir = downloadDir + folder;
    var zipDest = '/lists';
    console.log('dir', dir);
    if (!fs.existsSync(__dirname + downloadDir)) {
        fs.mkdirSync(__dirname + downloadDir, { recursive: true });
        fs.chmodSync(__dirname + downloadDir, 777)
    }
    if (!fs.existsSync(__dirname + dir)) {
        fs.mkdirSync(__dirname + dir, { recursive: true });
        fs.chmodSync(__dirname + dir, 777)
    }
    if(sess.proc) {
        try {
            sess.proc.kill('SIGINT');
            fs.removeSync(__dirname + sess.dir);
            delete sess.proc;
            delete sess.dir;
        } catch(e) {
            console.log('error canceling proc_id', e);
        }
    }
    console.log("********************************************************************")
    // getting file data
    var args = [];
    // args.push('--get-thumbnail');
    // args.push('--get-description');
    // args.push('--get-duration');
    // args.push('--get-title');
    // args.push('--get-filename');
    args.push('--skip-download');
    args.push('--dump-json');
    args.push(URL);
    const TEN_MEGABYTES = 1000 * 1000 * 10;
    const options = {};
    const execFileOpts = { encoding: 'utf8' ,maxBuffer: TEN_MEGABYTES };

    // console.log(__dirname + youtube_dl + ' ' + args.join(' '))
    var proc = spawn(__dirname + youtube_dl, args, { execFileOpts, options }, function done(err, stdout, stderr) {
        if (err) {
            console.error('Error:', err.stack);
            try {
                proc.kill('SIGINT');
                fs.removeSync(__dirname + sess.dir);
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
    // console.log("sess.proc.pid before", sess.proc.pid)

    proc.stderr.on('data', function(data) {
        console.log('err', data.toString('utf8'));
        // process.stderr.write(data);
    });
    proc.stdout.on('data', function(data) {
        var data = JSON.parse(data);
        // console.log('data1', data);
        var progress = Math.ceil((data.playlist_index / data.n_entries * 100));
        total = data.n_entries;
        console.log('progress', progress);
        // console.log('data', data);
        console.log('data.n_entries', data.n_entries);
        console.log('data.webpage_url', data.webpage_url);
        console.log('data.playlist_index', data.playlist_index);
        if(!progress) {
            progress = 100;
        }
        io.to(sockets[socketIndex]).emit('progress', progress, data.webpage_url, data.thumbnail, data.title, data.description, data.playlist_index);
        // process.stdout.write(data);
    });
    proc.on('close', function(code, signal) {
        console.log('code', code);
        console.log('signal', signal);
        console.log('spawn closed');
        if(!signal && !code) {
            delete sess.proc;
            downloadList();
        }
        if(code) {
            io.to(sockets[socketIndex]).emit('failed', 'process failed');
        }
    });

    function downloadList() {
        console.log('start-downloading-list');
        var args = [];
        console.log('__dirname + ffmpeg', __dirname + ffmpeg)
        if(TYPE === 'mp3') {
            args.push('-i');
            args.push('-x');
            args.push('-f');
            args.push('bestaudio/best');
            args.push('--audio-quality');
            args.push('5');
            args.push('--audio-format');
            args.push('mp3');
            args.push('--ffmpeg-location');
            args.push(__dirname + ffmpeg);
            args.push('-o');
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
            args.push('-i');
            args.push('-f');
            args.push('best');
            args.push('--recode-video');
            args.push('mp4');
            args.push('--encoding');
            args.push('utf8');
            args.push('-o');
            args.push(__dirname + dir + '/%(title)s.' + TYPE);
        }

        args.push(URL);

        const TEN_MEGABYTES = 1000 * 1000 * 10;
        const options = {};
        const execFileOpts = { encoding: 'utf8' ,maxBuffer: TEN_MEGABYTES };
        var count = 0;
        var current_temp_file_name = '';
        var failedFiles = [];

        var proc = spawn(__dirname + youtube_dl, args, { execFileOpts, options }, function done(err, stdout, stderr) {
            if (err) {
                console.error('Error:', err.stack);
                console.log('proc.pid', proc.pid);
                try {
                    proc.kill('SIGINT');
                    fs.removeSync(__dirname + sess.dir);
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
            console.log('err', data.toString('utf8'));
            failedFiles.push(current_temp_file_name);
            io.to(sockets[socketIndex]).emit('item-failed', count);
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
            if(data.indexOf('Downloading video info webpage') > -1 || data.indexOf('[download] Downloading video') > -1) {
                current_temp_file_name = data.substr(data.indexOf(folder) + folder.length + 1).trim();
                // console.log('current_temp_file_name', current_temp_file_name)
                // console.log('dir', dir)
                count++;
            }
            console.log('data', data);
            if(data.indexOf('%') > -1) {
                var percent = Math.ceil(data.substr(data.indexOf(' ') + 1,data.length - (data.length - data.indexOf('%') + 1) - data.indexOf(' ')))
                console.log('percent',percent)
                console.log('count',count)
                io.to(sockets[socketIndex]).emit('item-progress', percent, count);
            } else {
                // waiting
            }
            // var percent = (data.playlist_index / data.n_entries * 100);
            // var percent = Math.ceil((pos / size * 100));
            // process.stdout.cursorTo(0);
            // process.stdout.clearLine(1);
            // process.stdout.write(percent + '%');
            // io.to(sockets[socketIndex]).emit('item-progress', percent, count);
            // process.stdout.write(data);
        });
        proc.on('close', function(code, signal) {
            console.log('code', code);
            console.log('signal', signal);
            console.log('execFile closed');
            if(!signal) {
                delete sess.proc;
                // removeFailedFiles(dir, failedFiles);
                createZip(dir);
            }
            // if(code) {
            //     io.to(sockets[socketIndex]).emit('failed', 'process failed');
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
                    fs.removeSync(__dirname + sess.dir);
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
                io.to(sockets[socketIndex]).emit('item-progress', percent, count);
            } else {
                // waiting
            }
            // var percent = (data.playlist_index / data.n_entries * 100);
            // var percent = Math.ceil((pos / size * 100));
            // process.stdout.cursorTo(0);
            // process.stdout.clearLine(1);
            // process.stdout.write(percent + '%');
            // io.to(sockets[socketIndex]).emit('item-progress', percent, count);
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
                io.to(sockets[socketIndex]).emit('failed', 'process failed');
            }
        });
    }

    function createZip(dir) {
        io.to(sockets[socketIndex]).emit('starting-zip');
        if (!fs.existsSync(__dirname + zipDest)) {
            fs.mkdirSync(__dirname + zipDest, { recursive: true });
        }
        var output = fs.createWriteStream(__dirname + zipDest + '/' + folder + '.zip');
        var archive = archiver('zip');
        output.on('close', function() {
            console.log(archive.pointer() + ' total bytes');
            console.log('archiver has been finalized and the output file descriptor has closed.');
            io.to(sockets[socketIndex]).emit('download-url', protocol + host + zipDest + '/' + folder + '.zip');
            fs.removeSync(__dirname + dir);
            setTimeout(function(){
                fs.removeSync(__dirname + zipDest + '/' + folder + '.zip')
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
            io.to(sockets[socketIndex]).emit('zip-progress', progress);
        });

        archive.on('end', function(){
            io.to(sockets[socketIndex]).emit('zip-end');
        })

        archive.pipe(output);

        // archive.glob(dir + '/*.' + TYPE, { cwd: '' });
        archive.glob('*.' + TYPE, { cwd: __dirname + dir }, { prefix: ''} );
        archive.finalize();
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
