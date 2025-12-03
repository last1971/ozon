# План оптимизации цен Ozon по порогам комиссии

## Проблема

Комиссия Ozon зависит от цены товара:
- до 100 руб: 14%
- 100-300 руб: 20%
- свыше 300 руб: 38-49% (зависит от категории)

При расчёте цены мы используем текущую комиссию из API, но она изменится если цена перейдёт через порог. Иногда выгоднее продавать за 299 руб (комиссия 20%) чем за 350 руб (комиссия 49%).

## Решение

Если `incoming_price < 150` и `min_price > 300`, пересчитать с комиссией 100-300 и сравнить прибыль.

---

## Этап 1: Загрузка комиссий

### 1.1. В `PriceService` добавить метод:

```typescript
async loadCommissionsFromXlsx(file: Buffer): Promise<void>
```

- Парсит XLSX (колонки: Категория, Тип товара, FBS 100-300, FBO 100-300)
- Дёргает `/v1/description-category/tree` для получения `type_id` по названиям
- Связывает по названию типа товара
- Сохраняет в Redis: `ozon:commission:{type_id}` → `{fbs: 0.20, fbo: 0.20}` (бессрочно)

### 1.2. Эндпоинт:

```
POST /api/price/ozon/load-commissions (multipart/form-data)
```

---

## Этап 2: Кэш sku → type_id

### 2.1. В `PriceService` (или `ProductService`) добавить метод:

```typescript
async getTypeId(sku: string): Promise<string>
```

- Смотрит в Redis: `ozon:type_id:{sku}`
- Если нет → дёргает `/v3/product/info/list` по `offer_id`
- Достаёт `type_id` из ответа
- Сохраняет в Redis бессрочно
- Возвращает `type_id`

---

## Этап 3: Оптимизатор цен

### 3.1. В `PriceService` добавить метод:

```typescript
async optimizeOzonPrice(
  price: IPriceable,
  percents: ObtainCoeffsDto,
  typeId: string
): Promise<UpdatePriceDto>
```

**Логика:**

```typescript
// 1. Первый расчёт
const result1 = calculatePrice(price, percents);

// 2. Проверка условия
if (price.incoming_price >= 150 || toNumber(result1.min_price) <= 300) {
  return result1;
}

// 3. Получить комиссию 100-300 из Redis
const commission = await this.redis.get(`ozon:commission:${typeId}`);
if (!commission) {
  return result1; // нет данных - возвращаем как есть
}

// 4. Выбрать FBS или FBO (по текущей логике: fboCount > fbsCount)
const newSalesPercent = /* fbs или fbo из commission */;

// 5. Второй расчёт с новой комиссией
const result2 = calculatePrice({...price, sales_percent: newSalesPercent}, percents);

// 6. Сравнить прибыль
const profit1 = calculatePay(price, percents, toNumber(result1.min_price));
const profit2 = calculatePay({...price, sales_percent: newSalesPercent}, percents, toNumber(result2.min_price));

// 7. Выбрать лучший вариант
return (profit2.pay > 0 && profit2.pay > profit1.pay) ? result2 : result1;
```

---

## Этап 4: Интеграция

### 4.1. `price.controller.ts:131` (`POST /api/price/calculate`):

```typescript
async calculate(@Body() body: { price: IPriceable; percents: ObtainCoeffsDto; typeId?: string }): Promise<UpdatePriceDto> {
  if (body.typeId) {
    return this.priceService.optimizeOzonPrice(body.price, body.percents, body.typeId);
  }
  return calculatePrice(body.price, body.percents);
}
```

- `typeId` приходит с фронта

### 4.2. `trade2006.good.service.ts:480`:

```typescript
// Проверить тип сервиса
if (service.constructor.name === 'PriceService') {
  // Ozon
  const typeId = await this.priceService.getTypeId(product.getSku());
  updatePrices.push(
    await this.priceService.optimizeOzonPrice(
      { /* price params */ },
      service.getObtainCoeffs(),
      typeId
    )
  );
} else {
  // WB, Yandex и др.
  updatePrices.push(
    calculatePrice({ /* price params */ }, service.getObtainCoeffs())
  );
}
```

---

## Структура Redis

| Ключ | Значение | TTL |
|------|----------|-----|
| `ozon:commission:{type_id}` | `{"fbs": 0.20, "fbo": 0.20}` | бессрочно |
| `ozon:type_id:{sku}` | `"970707376"` | бессрочно |

---

## Файлы для изменения

1. `src/price/price.service.ts` - добавить методы:
   - `loadCommissionsFromXlsx()`
   - `getTypeId()`
   - `optimizeOzonPrice()`

2. `src/price/price.controller.ts` - добавить:
   - `POST /api/price/ozon/load-commissions`
   - Изменить `calculate()` для поддержки `typeId`

3. `src/trade2006.good/trade2006.good.service.ts` - изменить:
   - Проверка типа сервиса в `updatePriceForService()`
   - Вызов `optimizeOzonPrice()` для Ozon

---

## Примечания

- XLSX загружается с фронта, не хранится на сервере
- Обновление комиссий ~раз в квартал
- При обновлении старые данные в Redis перезаписываются
