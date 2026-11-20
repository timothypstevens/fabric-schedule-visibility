import { Tooltip } from '@fluentui/react-components';
import { itemTypes, type ItemType } from '@rayfin-app/shared';
import { itemTypeColorTokens } from './item-type-colors';

export function ItemTypeStripe({ type }: { type: ItemType }) {
  return <Tooltip relationship="description" positioning="after" content={
    <div className="item-type-legend">
      <strong>Item type legend</strong>
      {itemTypes.map((itemType) => <div key={itemType}>
        <i style={{ backgroundColor: `var(${itemTypeColorTokens[itemType]})` }} aria-hidden />
        <span>{itemType}{itemType === type ? ' (this row)' : ''}</span>
      </div>)}
    </div>
  }>
    <span className="item-type-stripe" role="img" tabIndex={0}
      aria-label={`${type} color stripe; item type legend`}
      style={{ backgroundColor: `var(${itemTypeColorTokens[type]})` }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
        }
      }} />
  </Tooltip>;
}
