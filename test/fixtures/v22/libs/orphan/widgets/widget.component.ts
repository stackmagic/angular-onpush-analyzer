import { Component, OnInit } from "@angular/core";
import * as shared from "@shared";

@Component({
  selector: "orphan-widget",
  template: "<shared-button sharedHighlight>Go</shared-button>",
})
export class WidgetComponent implements OnInit, shared.ButtonComponent, shared.HighlightDirective {
  ngOnInit(): void {}
}
