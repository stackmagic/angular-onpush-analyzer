import { Component } from "@angular/core";

@Component({
  template: "<h2>{{ heading }}</h2>",
})
export class CardBaseComponent {
  heading = "";
}
