import { Component } from "@angular/core";
import { BaseDialogComponent, ButtonComponent } from "@acme/components";
import { VaultListComponent } from "../../../../libs/vault/src/vault-list.component";

@Component({
  selector: "app-shell",
  imports: [ButtonComponent, VaultListComponent],
  templateUrl: "./shell.component.html",
})
export class ShellComponent extends BaseDialogComponent {}
