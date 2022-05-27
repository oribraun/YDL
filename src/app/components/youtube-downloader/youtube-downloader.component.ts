import { Component, OnInit } from '@angular/core';

import * as io from 'socket.io-client';
import {animate, style, transition, trigger} from '@angular/animations';

declare var $;
@Component({
    selector: 'app-youtube-downloader',
    templateUrl: './youtube-downloader.component.html',
    styleUrls: ['./youtube-downloader.component.less'],
    animations: [
        trigger('fadeIn', [
            transition(':enter', [
                style({ opacity: '0' }),
                animate('.5s ease-out', style({ opacity: '1' })),
            ]),
        ]),
        trigger('items', [
            transition(':enter', [
                style({ transform: 'scale(0.5)', opacity: 0 }),  // initial
                animate('1s cubic-bezier(.8, -0.6, 0.2, 1.5)',
                    style({ transform: 'scale(1)', opacity: 1 }))  // final
            ]),
            transition(':leave', [
                style({ transform: 'scale(1)', opacity: 1, height: '*' }),
                animate('1s cubic-bezier(.8, -0.6, 0.2, 1.5)',
                    style({
                        transform: 'scale(0.5)', opacity: 0,
                        height: '0px', margin: '0px'
                    }))
            ])
        ])
    ],
})
export class YoutubeDownloaderComponent implements OnInit {

    // public URLinput = 'https://www.youtube.com/watch?v=PIEN5Ix8gqQ&list=PLKkFYyR1ctskzy5BGA7TvTJ1Lo-Fd8MJU'; // 2 songs
    public URLinput = 'https://www.youtube.com/playlist?list=PLCuR0GUtdmkazUxDYCv93ndqtFGZ_phkF'; // 13 songs
    public copyListUrl = '';
    public copyVideoUrl = '';
    private socket;
    private socketId;
    public list: ListItem[] = [];
    public successItems = 0;
    public failedItems = 0;
    public startingFetchingList: boolean = false;
    public listProgress: any = 0;
    public startingZip: boolean = false;
    public zipProgress: number = 0;
    public type: any = 'mp3';
    public startConvertion: boolean;
    public showLoader: boolean;
    public timer: any = {
        minutes: '00',
        seconds: '00',
        hours: '00'
    }
    public timerInterval: any;
    public _showTimer: boolean = false;
    public autoScrolling: boolean = true;
    private host;
    constructor() { }

    ngOnInit() {
        this.host = window.location.href;
        if (window.location.port === '4200') {
            this.host = 'http://localhost:4000/';
        }
        // this.socket = io(window.location.protocol + '//' + window.location.hostname + ':3002');
        this.socket = io(this.host);
        this.socket.on('set-socket-id', (id) => {
            this.socketId = id;
        });
        this.socket.on('progress', (progress, youtubeUrl, thumbnail, title, description, index) => {
            this.startConvertion = false;
            console.log('progress', progress);
            console.log('youtubeUrl', youtubeUrl);
            console.log('youtube_url', thumbnail);
            console.log('title', title);
            console.log('description', description);
            console.log('index', index);
            this.updateProgress(progress);
            const listItem = new ListItem(
                {
                    progress: 0,
                    failed: false,
                    success: false,
                    converting: false,
                    youtubeUrl: youtubeUrl,
                    thumbnail: thumbnail,
                    title: title,
                    description: description,
                    i: index
                }
            );
            this.list.push(listItem);
            this.stopLoader();
        });
        this.socket.on('item-progress', (progress, index, chunkData) => {
            console.log('item-index', index, progress + '%');
            // console.log('item-progress*************', progress);
            // console.log('this.list.length', this.list.length);
            const ele = $('.item-' + (index - 1))[0];
            // console.log('this.isScrolledIntoView(ele)', this.isScrolledIntoView(ele));
            if (!this.isScrolledIntoView(ele)) {
                this.scrollToElement(ele);
            }
            this.updateItemProgress(index, progress);
        });
        this.socket.on('item-convert', (index) => {
            console.log('item-convert*************', index);
            const ele = $('.item-' + (index - 1))[0];
            this.setItemAsConverting(index);
        });
        this.socket.on('item-failed', (index, chunkData) => {
            this.failedItems++;
            console.log('item-failed*************', index);
            // console.log('this.list.length', this.list.length);
            const ele = $('.item-' + (index - 1))[0];
            // console.log('this.isScrolledIntoView(ele)', this.isScrolledIntoView(ele));
            if (!this.isScrolledIntoView(ele)) {
                this.scrollToElement(ele);
            }
            this.setItemAsFailed(index);
        });
        this.socket.on('item-success', (index, chunkData) => {
            if (this.list[index - 1] && !this.list[index - 1].failed) {
                this.successItems++;
                console.log('item-success*************', index);
                // console.log('this.list.length', this.list.length);
                const ele = $('.item-' + (index - 1))[0];
                // console.log('this.isScrolledIntoView(ele)', this.isScrolledIntoView(ele));
                if (!this.isScrolledIntoView(ele)) {
                    this.scrollToElement(ele);
                }
                this.setItemAsSuccess(index);
            }
        })
        this.socket.on('all-failed', (data) => {
            console.log('all-failed');
            alert('all list failed downloading');
        })
        this.socket.on('all-files-failed', (data) => {
            console.log('all-files-failed', data);
                // const listItemMap = [];
                // for (const i in data) {
                //     listItemMap.push(this.list[parseInt(i, 0) - 1]);
                // }
                // console.log('listItemMap', listItemMap);
        })
        this.socket.on('starting-zip', () => {
            console.log('zip- start*************', );
            this.startingZip = true;
            setTimeout(() => {
                const el = $('.zip-progress')[0];
                this.scrollToElement(el);
            });
        });
        this.socket.on('zip-progress', (progress) => {
            console.log('zip- progress*************', progress);
            this.zipProgress = progress;
        });
        this.socket.on('zip-end', (progress) => {
            console.log('zip- end*************', progress);
            this.zipProgress = 100;
            this.stopTimer();
            this.resetAutoScrolling();
        });
        this.socket.on('download-url', (url) => {
            // window.location.href = url;
            this.unSetOnBeforeUnloadEvent();
            this.startDownload(url);
        });
        this.socket.on('failed', (err) => {
            // window.location.href = url;
            console.log('err', err)
            alert(err)
            this.stopAll();
        });
        this.startConvertion = false;
    }

    updateProgress(progress) {
        requestAnimationFrame(() => {
            this.listProgress = progress;
        });
    }
    updateItemProgress(index, progress) {
        requestAnimationFrame(() => {
            if (this.list[index - 1]) {
                this.list[index - 1].progress = progress;
            }
        });
    }
    setItemAsConverting(index) {
        requestAnimationFrame(() => {
            if (this.list[index - 1]) {
                this.list[index - 1].success = false;
                this.list[index - 1].failed = false;
                this.list[index - 1].converting = true;
            }
        });
    }
    setItemAsFailed(index) {
        requestAnimationFrame(() => {
            if (this.list[index - 1]) {
                this.list[index - 1].success = false;
                this.list[index - 1].failed = true;
                this.list[index - 1].converting = false;
            }
        });
    }

    setItemAsSuccess(index) {
        requestAnimationFrame(() => {
            if (this.list[index - 1]) {
                this.list[index - 1].success = true;
                this.list[index - 1].failed = false;
                this.list[index - 1].converting = false;
            }
        });
    }

    onConvertClick(): void {
        console.log('URL:' + this.URLinput);
        this.sendURL(this.URLinput);
    }
    sendURL(URL): void {
        if (URL.indexOf('youtube') > -1 && URL.indexOf('?') > -1) {
            const copyUrl = URL.split('?')[0];
            const copyParams = URL.split('?')[1];
            const copyParamsArray = copyParams.split('&');
            this.copyListUrl = '';
            this.copyVideoUrl = '';
            for (const p in copyParamsArray) {
                if (copyParamsArray[p].indexOf('list=') > -1) {
                    this.copyListUrl = copyUrl + '?' + copyParamsArray[p];
                    this.copyListUrl = this.copyListUrl.replace('watch', 'playlist');
                } else if (copyParamsArray[p].indexOf('v=') > -1) {
                    this.copyVideoUrl = copyUrl + '?' + copyParamsArray[p];
                }
                if (this.copyListUrl && this.copyVideoUrl) {
                    break;
                }
            }
        } else {
            this.copyListUrl = URL;
        }

        if (this.copyListUrl  && this.copyVideoUrl) {
            this.showModal();
        } else if (this.copyListUrl) {
            this.downloadList(this.copyListUrl);
        } else if (this.copyVideoUrl) {
            this.downloadList(this.copyVideoUrl);
        } else {
            alert('cannot detect youtube video or list');
            this.stopLoader();
            this.stopTimer();
            this.resetTimer();
            this.resetAutoScrolling();
        }
        // window.location.href = 'http://localhost:4000/download?URL=' + URL + '&TYPE=' + type.value;
    }

    showModal() {
        $('#conflict').modal('show');
    }
    hideModal() {
        $('#conflict').modal('hide');
    }
    startLoader() {
        this.showLoader = true;
    }
    stopLoader() {
        this.showLoader = false;
    }

    downloadList(URL): void {
        this.startConvertion = true;
        this.startLoader();
        this.stopTimer();
        this.resetTimer();
        this.startTimer();
        this.showTimer();
        this.resetAutoScrolling();
        this.setOnBeforeUnloadEvent();
        this.list = [];
        this.successItems = 0;
        this.failedItems = 0;
        this.startingFetchingList = false;
        this.listProgress = 0;
        this.startingZip = false;
        this.zipProgress = 0;
        this.hideModal();
        this.startingFetchingList = true;
        $.ajax({
            url: this.host + 'download-playlist',
            type: 'get',
            data: {URL: URL, TYPE: this.type, sId: this.socketId},
            success: (res) => {
                // if (res.url) {
                //     window.location.href = res.url;
                // }
                // this.stopLoader();
            },
            error: (err) => {
                alert(err);
                this.stopAll();
            }
        });
    }
    // download(URL): void {
    //     this.hideModal();
    //     $.ajax({
    //         url: 'http://localhost:4000/download-playlist',
    //         type: 'get',
    //         data: {URL: URL, TYPE: this.type, sId: this.socketId},
    //         success: (res) => {
    //             // if (res.url) {
    //             //     window.location.href = res.url;
    //             // }
    //             // this.stopLoader();
    //         },
    //         error: (err) => {
    //             alert(err);
    //             this.stopAll();
    //         }
    //     });
    // }

    stopAll() {
        this.list = [];
        this.startingFetchingList = false;
        this.listProgress = 0;
        this.startingZip = false;
        this.zipProgress = 0;
        this.stopLoader();
        this.stopTimer();
        this.resetTimer();
        this.hideTimer();
        this.resetAutoScrolling();
        this.unSetOnBeforeUnloadEvent();
    }

    isScrolledIntoView(el): boolean {
        if (el) {
            const rect = el.getBoundingClientRect();
            const elemTop = rect.top;
            const elemBottom = rect.bottom;

            // Only completely visible elements return true:
            // console.log('elemTop', elemTop);
            // console.log('elemBottom', elemBottom);
            const isVisible = (elemTop >= 0) && (elemBottom <= window.innerHeight);
            // Partially visible elements return true:
            // isVisible = elemTop < window.innerHeight && elemBottom >= 0;
            return isVisible;
        } else {
            return true;
        }
    }

    scrollToElement(el): void {
        if (this.autoScrolling) {
            // el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            $('html, body').animate({
                scrollTop: $(el).offset().top
            }, 500);
        }
    }

    startDownload(filePath): void {
        const link = document.createElement('a');
        link.href = filePath;
        if (filePath.indexOf('.zip') === -1) {
            link.target = '_blank';
        }
        link.download = filePath.substr(filePath.lastIndexOf('/') + 1);
        link.click();
        link.remove();
    }

    startDownloadBlob(blob, fileName): void {
        const link = document.createElement('a');
        const data = Uint8Array.from(blob.data);
        const content = new Blob([data.buffer], { type: blob.type });
        const encodedUri = window.URL.createObjectURL(content);
        link.href = encodedUri;
        if (fileName.indexOf('.zip') === -1) {
            link.target = '_blank';
        }
        link.download = fileName;
        link.click();
        link.remove();
    }
    startTimer() {
        let seconds = 0;
        let minutes = 0;
        let hours = 0;
        this.timerInterval = setInterval(() => {
            seconds++;
            if (seconds && seconds % 60 === 0) {
                seconds = 0;
                minutes++;
            }
            if (minutes && minutes % 60 === 0) {
                minutes = 0;
                hours++;
            }
            this.calcTimer(seconds, minutes, hours);
        }, 1000);
    }
    calcTimer(seconds, minutes, hours) {
        this.timer.seconds = seconds < 10 ? '0' + seconds : seconds;
        this.timer.minutes = minutes < 10 ? '0' + minutes : minutes;
        this.timer.hours = hours < 10 ? '0' + hours : hours;
    }
    stopTimer() {
        clearInterval(this.timerInterval);
    }
    resetTimer() {
        this.timer.minutes = '00';
        this.timer.seconds = '00';
        this.timer.hours = '00';
    }
    showTimer() {
        this._showTimer = true;
    }
    hideTimer() {
        this._showTimer = false;
    }
    setOnBeforeUnloadEvent() {
        window.onbeforeunload = (event) => {
            event.returnValue = 'if download has started you will loose all your data. do you want to leave?';
        };
    }
    unSetOnBeforeUnloadEvent() {
        window.onbeforeunload = (event) => {};
    }
    toggleAutoScrolling() {
        this.autoScrolling = !this.autoScrolling;
    }
    resetAutoScrolling() {
        this.autoScrolling = true;
    }

    downloadOneItem(item: ListItem) {
        const youtubeUrl = item.youtubeUrl;
        // this.startLoader();
        $.ajax({
            url: this.host + 'download-item',
            type: 'get',
            data: {URL: youtubeUrl, TYPE: this.type, sId: this.socketId},
            success: (res) => {
                // if (res.url) {
                //     window.location.href = res.url;
                // }
                // this.stopLoader();
                if (res && res.blob && res.fileName) {
                    console.log('res.fileName', res.fileName)
                    console.log('res.blob', res.blob)
                    this.startDownloadBlob(res.blob, res.fileName);
                }
                // this.stopLoader();
            },
            error: (err) => {
                alert(err);
                this.stopLoader();
            }
        });
        console.log('item', item);
    }

}

export class ListItem {
    progress = 0;
    failed: boolean;
    success: boolean;
    converting: boolean;
    youtubeUrl: string;
    thumbnail: string;
    title: string;
    description: string;
    i: number;

    constructor(obj?: Partial<ListItem>) {
        Object.assign(this, obj);
    }
}
