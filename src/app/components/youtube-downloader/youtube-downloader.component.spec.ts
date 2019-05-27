import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { YoutubeDownloaderComponent } from './youtube-downloader.component';

describe('YoutubeDownloaderComponent', () => {
  let component: YoutubeDownloaderComponent;
  let fixture: ComponentFixture<YoutubeDownloaderComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ YoutubeDownloaderComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(YoutubeDownloaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
