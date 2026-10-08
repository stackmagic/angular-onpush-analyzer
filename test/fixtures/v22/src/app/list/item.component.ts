import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "app-item",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<span sharedButton>{{ item() }}</span>',
})
export class ItemComponent {
  readonly item = input.required<string>();
}
