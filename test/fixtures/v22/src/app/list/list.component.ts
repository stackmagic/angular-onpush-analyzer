import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { ItemComponent } from "./item.component";

@Component({
  selector: "app-list",
  imports: [ItemComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @for (item of items(); track item) {
      <app-item [item]="item" />
    } @empty {
      <p>No items</p>
    }
  `,
})
export class ListComponent {
  readonly items = input<string[]>([]);
}
