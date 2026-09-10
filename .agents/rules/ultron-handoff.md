# ULTRON — سیستم تریدینگ الگوریتمی
## فایل هندداف کامل — هر چت جدید این فایل رو اول بخون

---

## 🎯 هدف و فلسفه
- فلسفه: **Red Pill** — خالص ریاضی، بدون احساسات، بدون circuit breaker
- سیستم **PAPER** فعاله (شبیه‌سازی)
- هدف: وقتی Paper به اندازه کافی رسید، وارد MICRO (لایو) بشه
- کاربر ایرانیه — جواب همیشه فارسی باشه

---

## 📁 ساختار پروژه
- Framework: Next.js روی Vercel (Frankfurt)
- Database: Supabase — جدول paper_trades
- Cache: Upstash Redis
- Notifications: Telegram Bot
- Exchange (data): Bybit Mainnet — فقط قیمت‌گیری، بدون API Key
- Exchange (live): Bybit — وقتی TRADE_MODE=MICRO

---

## ⚙️ استراتژی معاملاتی (strategy.ts)

سیگنال‌ها از این منابع:
1. Gann Square of 9 — حمایت/مقاومت ریاضی
2. Volume Capitulation — تشخیص ورود بازارگردانان
3. ATR Dynamic SL — حد ضرر از نوسان واقعی (ATR × 1.5)
4. Macro Trend Filter — فقط با EMA50 روی تایم‌فریم 1h

منطق ورود:
- Ranging: Mean Reversion از سطوح Gann
- Trending: Bounce از سطوح Gann با R:R حداقل 1.5x
- Capitulation: Market Order فوری

فایل‌های کلیدی:
- src/lib/trading/strategy.ts
- src/lib/trading/gann.ts
- src/lib/trading/risk.ts
- src/lib/trading/executor.ts
- src/app/api/cron/manage-trades/route.ts
- src/app/api/cron/hunter/route.ts

---

## 💰 مدیریت ریسک (risk.ts)

### Self-Calibrating Kelly (آخرین آپدیت):
- تا 30 ترید: Win Rate پیش‌فرض 45%، R:R پیش‌فرض 2.0
- بعد از 30 ترید: Win Rate و R:R واقعی از دیتابیس خونده میشه
- فرمول: Quarter-Kelly × 0.25
- سقف: حداکثر 1.5% ریسک از حساب در هر ترید
- Wild Market: ریسک نصف میشه

### لایه‌های محافظتی:
1. SL: ATR-based، حداقل 0.3% از قیمت
2. Max Margin: 50% از حساب
3. Max Concurrent: Trending=8، Ranging=3 پوزیشن
4. Cooldown: 15 دقیقه بعد از هر ترید روی همون نماد
5. DEFCON: اگه بازار بیش از 10% ریزش کنه، Trailing Stop غیرفعال میشه

---

## 📊 نتایج بک‌تست — دو سناریو

### سناریو A: واقع‌بینانه (Position Cap $50k)
بازه: 2021 تا 2026، 10 ارز، 22,695 ترید
- شروع: $1,000
- پایان: $4,647,648
- Win Rate: 27.56%
- Max Drawdown: 22.85%

### سناریو B: تئوری (بدون Position Cap — Infinite Liquidity)
همه چیز یکسان فقط سقف پوزیشن برداشته شده:
- شروع: $1,000
- پایان: $5.17 × 10^36
- Win Rate: 27.56% (یکسان! استراتژی تغییر نکرده)
- Max Drawdown: 59.91%

نکته مهم: Win Rate در هر دو سناریو یکسانه. تفاوت فقط در سایز پوزیشنه.

---

## 💰 ضرایب Reset Strategy — هر 6 ماه $X میذاری

### سناریو واقع‌بینانه ($50k cap) — از $1,000 شروع:
| دوره | شرایط | ضریب | $1,000 میشه |
|---|---|---|---|
| 2021-H1 | Bull اوج | 404x | $404,000 |
| 2021-H2 | Bull | 2.6x | $2,604 |
| 2022-H1 | Bear شروع | 1.6x | $1,613 |
| 2022-H2 | Bear عمیق | 1.17x | $1,169 |
| 2023-H1 | Ranging | 1.13x | $1,126 |
| 2023-H2 | Ranging | 1.10x | $1,097 |
| 2024-H1 | Recovery | 1.16x | $1,156 |
| 2024-H2 | Bull قوی | 1.25x | $1,250 |
| 2025-H1 | Bull | 1.14x | $1,138 |
| 2025-H2 | Ranging | 1.09x | $1,085 |
| 2026-H1 | Bear جزئی | 1.05x | $1,047 |

محدودیت: وقتی balance از ~$500k رد شد، cap $50k کیک میکنه و رشد نسبی کند میشه.

### سناریو تئوری (بدون cap) — ضرایب واقعی هر دوره:
| دوره | شرایط | ضریب | $1,000 میشه |
|---|---|---|---|
| 2021-H1 | Bull اوج | 8,816x | $8.8 میلیون |
| 2021-H2 | Bull | 14,342x | $14.3 میلیون |
| 2022-H1 | Bear شروع | 6,374x | $6.4 میلیون |
| 2022-H2 | Bear عمیق | 65x | $65,000 |
| 2023-H1 | Ranging | 167x | $167,000 |
| 2023-H2 | Ranging | 154x | $154,000 |
| 2024-H1 | Recovery | 181x | $181,000 |
| 2024-H2 | Bull قوی | 291,000x | $291 میلیون |
| 2025-H1 | Bull | 743x | $743,000 |
| 2025-H2 | Ranging | 647x | $647,000 |
| 2026-H1 | Bear جزئی | 46.7x | $46,700 |

نکته: این ضرایب تئوریکن. بازار واقعی نقدینگی کافی نداره.
حتی بدترین دوره (Bear H2-2022): 65x — چون سیستم SHORT میگیره.

### قانون Reset (نقد کردن):
- فرمول: سرمایه شروع × ضریب دوره = موجودی پایان
- هر رقمی که بذاری، همون ضریب اعمال میشه (Kelly نسبیه)
- مثال: $5,000 در H2-2024 تئوری = $5,000 × 291,000 = $1.45 میلیارد
- وقتی نقد کنی: تصمیم کاملاً با کاربره (نصف، همه، یه عدد رندوم)

---

## 📈 وضعیت لایو (Paper Trading)

آمار تا 10 سپتامبر 2026:
- بازار: Bearish — سیستم به درستی SHORT میده
- نیاز به کالیبراسیون Kelly: حداقل 30 ترید (الان ~15-20 ترید)
- Win Rate فعلی لایو: ~30-45% (آمار کافی نیست)
- پوزیشن‌های باز: ADA/SOL/BNB/LINK همه SHORT

---

## 🔧 متغیرهای محیطی (.env.local)
- TRADE_MODE = "PAPER" (موقع لایو: MICRO)
- BYBIT_API_KEY = ... (برای MICRO لازمه)
- BYBIT_SECRET = ... (برای MICRO لازمه)

---

## 🚫 قوانین تغییرناپذیر
1. بدون اجازه صریح کاربر هیچ کدی تغییر نده
2. قبل از هر تغییر استراتژیک، بک‌تست بگیر
3. Win Rate یا Drawdown نباید بدتر بشن
4. هیچ Circuit Breaker احساسی اضافه نشه
5. هیچ "توقف ترید بعد از N ضرر" اضافه نشه

---

## 📝 تاریخچه تصمیمات کلیدی
1. Hyperliquid → Bybit: بخاطر Geo-Blocking روی Vercel
2. Scalping Brain رد شد: Drawdown از 22% به 36% رفت
3. Self-Calibrating Kelly: اضافه شد — Win Rate واقعی از DB
4. DEFCON: فقط روی Trailing Stop اثر داره، ترید رو متوقف نمیکنه
5. setSandboxMode حذف شد: Bybit Mainnet مستقیم
6. Symbol Filter اضافه شد: نمادهای ناشناس رو skip میکنه
7. بک‌تست Aggressive: لوریج 10x ثابت، بدون cap — برای تحلیل نه Production

---

## 🚨 آستانه اطلاع‌رسانی (زمان نقد کردن)
سیستم وقتی balance به این آستانه‌ها رسید اطلاع میده:
- Ranging/Bear: 10x شد
- Normal: 50x شد
- Bull Market: 100x شد
(این feature در roadmap کدنویسی قرار داره)
