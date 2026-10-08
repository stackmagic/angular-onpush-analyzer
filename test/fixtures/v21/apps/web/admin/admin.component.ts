import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
  selector: "app-admin",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: "<acme-button>Admin</acme-button>",
})
export class AdminComponent {}
