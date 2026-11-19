-- Amounts are VAT-inclusive from here on: what the owner deposits and the operator matches.
-- Subscriptions still at the old default supply price move to the same price with VAT
-- (30,000 -> 33,000 a month, 360,000 -> 396,000 a year). Custom amounts and recorded payments
-- (what was actually deposited) are left as they are.
UPDATE subscriptions SET amount = 33000 WHERE cycle = 'monthly' AND amount = 30000;
UPDATE subscriptions SET amount = 396000 WHERE cycle = 'yearly' AND amount = 360000;

-- The seeded product guide still states the old prices. Where its current version has the
-- original line, add a version with only that line changed (operators' other edits stay).
INSERT INTO guide_versions (slug, version, body, author, note, created_at)
SELECT g.slug, g.version + 1,
  replace(v.body,
    '- 구독은 사이트마다: 월 30,000원 또는 연 360,000원(공급가, 부가세 별도). 사이트마다 금액을 바꿀 수 있다.',
    '- 구독은 사이트마다: 월 33,000원 또는 연 396,000원(부가세 포함, 공급가 30,000원·360,000원). 사이트마다 금액을 바꿀 수 있다. 사장님께 금액을 말할 때는 부가세 포함 금액으로 말한다.'),
  '플랫폼', '금액을 부가세 포함으로 표기', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM guides g JOIN guide_versions v ON v.slug = g.slug AND v.version = g.version
WHERE g.slug = 'product-policy'
  AND instr(v.body, '- 구독은 사이트마다: 월 30,000원 또는 연 360,000원(공급가, 부가세 별도).') > 0;
UPDATE guides SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'product-policy'
  AND EXISTS (SELECT 1 FROM guide_versions v WHERE v.slug = guides.slug AND v.version = guides.version + 1);
