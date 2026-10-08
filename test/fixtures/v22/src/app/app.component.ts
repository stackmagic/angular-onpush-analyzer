import { Component } from "@angular/core";
import { ButtonComponent } from "@shared";
import { ListComponent } from "./list/list.component";

@Component({
  selector: "app-root",
  imports: [ButtonComponent, ListComponent],
  templateUrl: "./app.component.html",
})
export class AppComponent {
  title = "fixture";
}
