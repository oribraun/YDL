import {Component, Input, OnInit} from '@angular/core';

@Component({
  selector: 'app-success-icon',
  templateUrl: './success-icon.component.html',
  styleUrls: ['./success-icon.component.less']
})
export class SuccessIconComponent implements OnInit {

  @Input() type;
  constructor() { }

  ngOnInit() {
  }

}
