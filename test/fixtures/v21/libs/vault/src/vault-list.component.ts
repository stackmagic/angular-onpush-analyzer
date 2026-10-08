import { Component } from "@angular/core";
import { VaultItemComponent } from "./vault-item.component";

@Component({
  selector: "vault-list",
  imports: [VaultItemComponent],
  template: "<vault-item></vault-item>",
})
export class VaultListComponent {}
