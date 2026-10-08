import { ChangeDetectionStrategy, Component, NgModule } from "@angular/core";
import { SharedCardBase as CardBase } from "@shared";

@Component({
  selector: "app-legacy",
  standalone: false,
  changeDetection: ChangeDetectionStrategy.Default,
  template: "<div class=\"card\">{{ heading }}</div>",
})
export class LegacyComponent extends CardBase {}

@NgModule({ declarations: [LegacyComponent] })
export class LegacyModule {}
