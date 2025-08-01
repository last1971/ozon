import { Expose, Exclude } from 'class-transformer';

@Exclude()
export class TransferOutLineDTO {
    @Expose({ name: 'REALPRICEFCODE' })
    id: number;

    @Expose({ name: 'SFCODE' })
    transferOutId: number;

    @Expose({ name: 'GOODSCODE' })
    goodId: string;

    @Expose({ name: 'PRICE' })
    price: number;

    @Expose({ name: 'QUAN' })
    quantity: number;

    @Expose({ name: 'OPRIH' })
    operationType: number;

    @Expose({ name: 'REALPRICECODE' })
    invoiceLineId: number;

    @Expose({ name: 'DIRECTSKLADNEED' })
    directWarehouseNeed: number;

    @Expose({ name: 'DIRECTSHOPNEED' })
    directShopNeed: number;

    @Expose({ name: 'DIRECTSHOP' })
    directShop: number;

    @Expose({ name: 'DIRECTSKLAD' })
    directWarehouse: number;

    @Expose({ name: 'GTD' })
    gtd: string;

    @Expose({ name: 'STRANA' })
    country: string;

    @Expose({ name: 'SUMMAP' })
    totalAmount: number;

    @Expose({ name: 'SECONDINSERT' })
    secondInsert: number;

    @Expose({ name: 'MARK1C' })
    mark1c: number;

    @Expose({ name: 'USERNAME' })
    username: string;

    @Expose({ name: 'SHOP_SALED_NAKL_D_ID' })
    shopSaledNaklDId: number;

    @Expose({ name: 'INSERT_ATTR' })
    insertAttr: string;

    @Expose({ name: 'MODIFY_ATTR' })
    modifyAttr: string;
} 