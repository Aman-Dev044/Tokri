import { GroceryLoader } from '@mandi/design-system';

/**
 * The route-transition loading state for every segment under app/.
 *
 * This is the client's "grocery loading animation everywhere" in its largest
 * form: the basket fills with produce while the next route streams in, tinted
 * with whatever aisle is currently live.
 */
export default function Loading() {
  return <GroceryLoader.Page label="Filling your basket" />;
}
