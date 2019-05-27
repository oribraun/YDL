import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import {YoutubeDownloaderComponent} from './components/youtube-downloader/youtube-downloader.component';
import {CopyrightsComponent} from './components/copyrights/copyrights.component';

const routes: Routes = [
  { path: '', component:  YoutubeDownloaderComponent, pathMatch: 'full'},
  { path: 'copyrights', component: CopyrightsComponent, pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
