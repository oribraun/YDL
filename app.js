"use strict";

var express = require('express');
var session = require('express-session');
var cors = require('cors');
var archiver = require('archiver');
var fs = require('fs-extra');
const execFile = require('child_process').execFile;
var app = express();
var io = require('socket.io')(3002);


app.set('trust proxy', 1)
app.use(session({
    secret: 'keyboard cat',
    resave: false,
    saveUninitialized: false ,
    cookie: { secure: false, maxAge: 1000*60*60*24 }
}))
app.use(cors());
app.listen(4000, function() {
    console.log('Server Works !!! At port 4000');
});
app.use("/lists", express.static(__dirname + '/lists'));
app.use("/dist", express.static(__dirname + '/dist'));


var sockets = [];
var sess;

app.get('/', function(req, res) {
    res.sendFile(__dirname + '/dist/index.html');
})
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
    var dir = '/downloads/' + folder;
    var zipDest = '/lists';
    console.log('dir', dir);
    if (!fs.existsSync(__dirname + '/downloads/')) {
        fs.mkdirSync(__dirname + '/downloads/', { recursive: true });
    }
    if (!fs.existsSync(__dirname + dir)) {
        fs.mkdirSync(__dirname + dir, { recursive: true });
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
    const execFileOpts = { maxBuffer: TEN_MEGABYTES };

    var proc = execFile(__dirname + '/src/youtube-dl.exe', args, { execFileOpts, options }, function done(err, stdout, stderr) {
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
    sess.proc = proc;
    sess.dir = dir;
    console.log("sess.proc.pid before", sess.proc.pid)

    proc.stderr.on('data', function(data) {
        console.log('err', data);
        // process.stderr.write(data);
    });
    proc.stdout.on('data', function(data) {
        var data = JSON.parse(data);
        // console.log('data', data);
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
        console.log('execFile closed');
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
        if(TYPE === 'mp3') {
            args.push('-x');
            args.push('-f');
            args.push('bestaudio/best');
            args.push('--audio-quality');
            args.push('0');
            args.push('--audio-format');
            args.push('mp3');
            args.push('--ffmpeg-location');
            args.push(__dirname + '/src/ffmpeg.exe');
            args.push('-o');
            args.push(dir + '/%(title)s.' + TYPE);
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
            args.push(dir + '/%(title)s.' + TYPE);
        }

        args.push(URL);

        const TEN_MEGABYTES = 1000 * 1000 * 10;
        const options = {};
        const execFileOpts = { maxBuffer: TEN_MEGABYTES };
        var count = 0;

        var proc = execFile(__dirname + '/src/youtube-dl.exe', args, { execFileOpts, options }, function done(err, stdout, stderr) {
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
        // console.log("sess.proc.pid before", sess.proc.pid)
        sess.proc = proc;
        console.log("sess.proc.pid after", sess.proc.pid)

        proc.stderr.on('data', function(data) {
            console.log('err', data);
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

    res.json({});
});
