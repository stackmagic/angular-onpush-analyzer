import { Component, forwardRef } from "@angular/core";
import { VaultListComponent } from "./vault-list.component";

@Component({
  selector: "vault-item",
  imports: [forwardRef(() => VaultListComponent)],
  template: "<vault-list></vault-list>",
})
export class VaultItemComponent {}
