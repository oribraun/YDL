import { BrowserModule} from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import {FormsModule} from '@angular/forms';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { YoutubeDownloaderComponent } from './components/youtube-downloader/youtube-downloader.component';
import { SuccessIconComponent } from './components/success-icon/success-icon.component';
import { CopyrightsComponent } from './components/copyrights/copyrights.component';

@NgModule({
  declarations: [
    AppComponent,
    YoutubeDownloaderComponent,
    SuccessIconComponent,
    CopyrightsComponent
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    FormsModule
  ],
  providers: [
      FormsModule
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
