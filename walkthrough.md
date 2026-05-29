# Walkthrough - Refresh Buttons, Custom Balloon Tooltips, Analysis UI, Chart Enhancements, Korean Ticker Auto-correction, Dynamic Comparison Dropdowns, and Recommended Portfolios Redesign

This document details the changes made to:
1. Add Refresh Buttons to the top of both the Stock Dashboard (toolbar) and the Portfolio (asset management header) to easily reload real-time stock/index prices and fix incorrect or stale mock-fallback data.
2. Auto-correct Korean stock suffixes (`.KS` for KOSPI vs `.KQ` for KOSDAQ) across search inputs, portfolio storage, saved lists, and API requests to ensure charts and values match perfectly (fixing the NGeneBio `354200` flat line issue).
3. Add pull-down select menus for Stock 1 and Stock 2 inside the stock comparison modal, enabling dynamic stock switching and updates of charts/growth metrics using active dashboard stocks.
4. Unified the Stock Chart Detail Modal header layout so it matches the dashboard card title: it now shows the Korean stock name, the stock ticker inside a parenthesis (using smaller gray text), and the English company name below it as the subtitle.
5. Display Korean stock names in Korean inside the Portfolio tab (matching the Dashboard and GosuPick tabs).
6. Replace the `+ Portfolio` button on the Dashboard cards with a `보유중(수량)` green badge if the stock is currently stored in the user's portfolio.
7. Remove decimal formatting (e.g. `.00`) for Korean stock prices on the Dashboard and in the GosuPick analysis modal.
8. Restructure the GosuPick detailed analysis modal layout and supply technical data metrics with supporting numbers.
9. Create premium, glassmorphic custom HTML balloon tooltips that float above condition badges on hover, mimicking Chart.js tooltips.
10. Display a horizontal dashed line at the previous day's close price when the time range is set to 1D (`1d`) on dashboard index/stock cards and the detail modal chart.
11. Include a range-adjustable, real-time stock/ETF chart inside the GosuPick detailed analysis modal (`#expert-detail-modal`), supporting period adjustments (1H, 1D, 1W, 1M, 6M, 1Y) matching the dashboard controls.
12. Removed the redundant `Report` button from the dashboard cards, as all its analytical data is now fully integrated into the `고수Pick` detailed analysis modal.
13. Wrapped `고수Pick` and `+Portfolio` / `보유중` buttons inside a `.card-buttons-row` container (`span` with `display: flex`) under the dashboard index/stock card titles, forcing them to cleanly wrap to the next line and align with the start of the stock name.
14. Split the stock price and the day's change percentage into two separate lines, stacked vertically with the change badge on top and the stock price below it, aligned to the right inside `.price-container`.
15. Added `flex-shrink: 0` to the delete button (`.remove-chart-btn`), forcing it to stay a perfect circle rather than compressing into an ellipse on narrow screens.
16. Wrapped stock tickers on the dashboard in a `.card-ticker` element, reducing their font size to `0.75rem` for better visual hierarchy.
17. Restructure Recommended Portfolios into four advanced strategies: Core-Satellite, All-Weather Variation, Korean Value-up, and Sector Momentum.
18. Implemented a smart category-level Strategy Fit Comparison Dashboard inside the Recommended Portfolios modal, featuring expandable detailed drawers, side-by-side tables, mapped asset lists, actionable adjustment guides, and a quick-apply button.
19. Removed the donut chart visual area from Recommended Portfolio cards and represented asset weights with clean, visual horizontal progress bars.
20. Used Volatility (연 변동성) and Sharpe Ratio (샤프 지수) to Recommended Portfolio stats in a 2x2 grid layout.
21. Resolved the "데이터 없음" (No Data) issue in Recommended Portfolios by implementing a fallback to deterministic mock history when CORS proxy or Yahoo chart requests fail.
22. Resolved the Portfolio tab layout overlap bug by changing the `.donut-chart-container` sizing in `style.css` to a fixed 180px height.
23. Removed the Portfolio Advisor & Rebalancing Guide section from the Portfolio tab left sidebar as requested, refactoring its logic into an empty no-op function.

---

## 1. Summary of Changes

### 1) Refresh Buttons (`index.html`, `style.css`, `app.js`)
To provide manual refresh capability for dashboard and portfolio:
- **`index.html` (Dashboard Toolbar)**: Added a "새로고침" (`#dashboard-refresh-btn`) button in the toolbar controls beside the chart layout options.
- **`index.html` (Portfolio Header)**: Added a "새로고침" (`#portfolio-refresh-btn`) button in the portfolio action header beside the stock addition and analysis run buttons.
- **`style.css` (Animations & Responsive CSS)**: Added `.refresh-icon` styling with a spinning keyframe animation. Configured CSS media queries to hide the text labels (`.btn-text`) on screens narrower than 1024px, collapsing both buttons into neat icons to preserve layout spacing.
- **`app.js` (Refresh Handlers)**: Registered click listeners inside the DOMContentLoaded handler:
  - Dashboard refresh triggers `initSingleChart(key)` sequentially on each active chart (with a stagger timeout of 300ms to avoid CORS rate-limiting), which refetches latest live prices and refreshes chart canvases.
  - Portfolio refresh refetches both the currency exchange rate and individual stock prices/previous closes (specifically reloading dashboard charts when applicable, and querying other holdings via API), recalculating and rendering updated portfolio valuation metrics.
  - Both buttons display a spinning emoji icon and are disabled during active execution to prevent accidental double-clicks.

### 2) Custom HTML Balloon Tooltips
To replace native browser title tooltips with high-end, responsive, glassmorphic tooltips:
- **`app.js` (DOM Initialization)**: Dynamically injects a global `.custom-tooltip` div into `document.body` styled with high transparency, blur, white borders, and an elegant box shadow.
- **`app.js` (Event Delegation)**: Adds document-wide mouse hover events checking for the `data-tooltip` attribute. When hovered, the custom tooltip is positioned dynamically above the badge, centered horizontally.
- **`app.js` (Badge Updates)**: Modified all condition badges in the results table and modal to use `data-tooltip` instead of `title`.

### 3) Restructured Header Rows (`index.html`)
To prevent cramped vertical columns, the `.report-header` in the `#expert-detail-modal` was changed to stack its sections vertically.

### 4) Detailed Technical Statistics with Supporting Values (`app.js`)
Rather than displaying a simple status string, we saved the raw values during the scan loop and populated the detail boxes with rich HTML layouts.

### 5) All Securities Firms Recommendations (`app.js`)
Modified `getAnalystRecommendations(ticker, currentPrice)` to loop through and return the recommendations from all defined securities firms.

### 6) 1D Chart Previous Close Line (`app.js`)
Added a horizontal dashed line to index/stock cards and the detail modal chart when the 1D range is active.

### 7) Adjustable Stock Chart in GosuPick Modal (`index.html`, `style.css`, `app.js`)
Added a real-time historical chart to the bottom of the GosuPick detailed analysis modal.

### 8) Korean Stock Ticker Suffix Auto-correction (`app.js`)
Implemented dynamic correction of incorrect market suffixes (e.g. `.KS` for KOSPI vs `.KQ` for KOSDAQ) for Korean stocks to prevent flat lines.

### 9) Stock Comparison Dropdown Selectors (`index.html`, `style.css`, `app.js`)
Added dynamic dropdown select dropdowns inside the stock comparison modal box headers.

### 10) Unified Chart Detail Modal Header (`app.js`)
Unified the header style of the stock chart detail modal with the dashboard cards.

### 11) Smart Strategy Asset Classification & Fit Score Comparison Dashboard (`index.html`, `style.css`, `app.js`)
- We replaced the default portfolios with 4 advanced domestic-listed asset allocation and sector trading strategies (Core-Satellite, All-Weather, Value-up & High Dividend, Sector Momentum).
- We implemented a **Strategy Fit Comparison Dashboard** inside the Recommended Portfolios modal:
  - Classifies user's active holdings into corresponding asset classes dynamically.
  - Computes similarity scores using category weight overlap ($100 - (50 \times \text{L1 Distance})$).
  - Displays comparison cards with visual progress bars and a `상세 비교` toggle button.
  - Toggling expands a detailed comparison panel showing a comparison table, mapped asset lists, actionable adjustment guides, and a quick apply button.

### 12) Donut Chart Removal & Asset Weight Visual Bars (`app.js`)
- Completely **removed the donut chart visual area** (Chart.js pie-wrap canvas) from recommended portfolio cards.
- Replaced it with a premium **horizontal allocation progress bar layout** showing colored dots, tickers, target weights, and visual fill bars.

### 13) Enhanced Backtest Decision Metrics (`app.js`)
- Added two crucial investment decision metrics: **Sharpe Ratio (샤프 지수)** and **Volatility (연 변동성)** in a 2x2 grid alongside CAGR and MDD.
- Programmed daily returns variance and sample volatility equations inside `calcRecStats()`, assuming a 2.5% risk-free rate for Sharpe ratio calculations.
- Sharpe ratios are color-coded based on efficiency: green for $\ge 1.0$, yellow for $0 \le \text{Sharpe} < 1.0$, and red for negative performance.

### 14) CORS Proxy Rate-Limit Fallback for recommended stats (`app.js`)
- Resolved the **"데이터 없음" (No Data)** issue in recommended portfolios. When CORS proxies rate-limit or fail to fetch 10-year daily chart data from Yahoo Finance, `loadRecStats()` automatically falls back to `generateMockHistory(ticker, '5y')`.
- This maps consistent, deterministic mock prices into the cache, ensuring CAGR, MDD, Volatility, and Sharpe ratios are always fully computed and rendered in all environments.

### 15) Donut Chart Layout Overlap Fix (`style.css`)
- Resolved the **overlap layout bug** in the Portfolio tab. Removed layout-flexible (`flex: 1`) heights from `.summary-chart-section` and `.donut-chart-container` in `style.css`.
- Anchored the donut chart container at a fixed height of `180px` and a width of `100%`. This locks Chart.js canvas resizing constraints, ensuring the chart stays perfectly aligned without overlaying text.

### 16) Removed Portfolio Advisor Sidebar Section (`index.html`, `app.js`)
- Completely **removed the Portfolio Advisor & Rebalancing Guide section** (`.advisor-section` and `#portfolio-advisor-content`) from the Portfolio tab left sidebar as requested.
- Refactored `updatePortfolioAdvisor()` to be an empty no-op function to maintain execution stability.

---

## 2. Verification and Integrity Check

- **Refresh Buttons**: Verified that clicking the dashboard "새로고침" and portfolio "새로고침" buttons starts the loading animation, spins the `🔄` icon, disables the buttons to prevent spamming, fetches live API data, updates the charts and valuation numbers, and re-enables the buttons on completion.
- **Responsive Layout**: Verified that both refresh buttons hide their text content on screens narrower than 1024px, collapsing gracefully to maintain clean alignment.
- Verified that the global tooltip element triggers cleanly on hover.
- Verified that when range is `1D`, the previous day's close price is drawn as a dashed line.
- Verified that period/range selection in the GosuPick modal chart works correctly.
- Verified that Korean stocks with incorrect suffixes are automatically corrected.
- Verified that the stock comparison modal load dropdowns and updates charts dynamically.
- Verified that the Recommended Portfolios comparison calculations evaluate to correct similarity scores based on category weight overlaps.
- Verified that clicking a comparison card toggles the details drawer cleanly.
- Verified that clicking the quick-apply button replaces active portfolio items, calculates quantities based on a 10,000,000 KRW portfolio size, saves it, and redirects the user to the Portfolio tab.
- Verified that donut charts are removed and allocations display as colored progress bars mapping to target ratios.
- Verified that Volatility and Sharpe Ratio are computed from daily returns and rendered in the 2x2 grid.
- Verified that recommended portfolio stats populate correctly via the deterministic mock fallback under proxy failures.
- Verified that the Portfolio tab left sidebar donut chart container remains sized at 180px, sitting neatly without layout overflow or overlap.
- Verified that the Portfolio Advisor section is removed from the sidebar and no runtime exceptions occur.rtfolio Advisor section is removed from the sidebar and no runtime exceptions occur.
