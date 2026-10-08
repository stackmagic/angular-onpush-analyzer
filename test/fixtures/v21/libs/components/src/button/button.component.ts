import { Component } from "@angular/core";

@Component({
  selector: "acme-button",
  template: "<button><ng-content /></button>",
})
export class ButtonComponent {}
