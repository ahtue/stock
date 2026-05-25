// Global Error Alert Catcher for debugging purposes
window.onerror = function (message, source, lineno, colno, error) {
    alert(`JS ERROR: ${message}\nSource: ${source}\nLine: ${lineno}\nColumn: ${colno}\nStack: ${error ? error.stack : 'N/A'}`);
    return false; // Let browser process it as well
};
window.onunhandledrejection = function (event) {
    alert(`Unhandled Rejection: ${event.reason}`);
};

// Global state for time range
let currentRangeKey = '6mo';
let currentChartType = 'line'; // 'line' or 'candlestick'
const hasSavedLogin = localStorage.getItem('google_access_token') && localStorage.getItem('google_token_acquired_at') && (Date.now() - parseInt(localStorage.getItem('google_token_acquired_at'))) < 50 * 60 * 1000;
let recentSearches = [];
let cachedKoreanStocks = null;
let googleTokenClient = null;
let googleAccessToken = null;
let googleUserInfo = null; // Global state for user profile in modal
const GOOGLE_CLIENT_ID = '865014531811-pn6eod566v3pe46f6tv9efv1la03h3t8.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxquDJrbEonmno3dfyUn6A98OQB8YSnSxW_pcuuYJkeEuWRaJgxyyPQpV0aaCLkujM-tQ/exec';

const rangeConfig = {
    '1h': { yahooRange: '1d', interval: '1m', filterLimit: 60 * 60 * 1000 },
    '1d': { yahooRange: '1d', interval: '5m' },
    '1w': { yahooRange: '5d', interval: '15m' },
    '1mo': { yahooRange: '1mo', interval: '1d' },
    '6mo': { yahooRange: '6mo', interval: '1d' },
    '1y': { yahooRange: '1y', interval: '1d' },
    '3y': { yahooRange: '5y', interval: '1wk', filterLimit: 3 * 365 * 24 * 60 * 60 * 1000 },
    '5y': { yahooRange: '5y', interval: '1mo' }
};

function formatChartLabel(date, rangeKey) {
    if (['1h', '1d'].includes(rangeKey)) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (rangeKey === '1w') {
        return date.toLocaleDateString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    } else if (['1mo', '6mo'].includes(rangeKey)) {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    }
}

// Configuration for the indices
const indices = {
    kospi: {
        name: '코스피',
        ticker: '^KS11',
        color: '#3b82f6', // neon-blue
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        elementId: 'kospi'
    },
    kosdaq: {
        name: '코스닥',
        ticker: '^KQ11',
        color: '#8b5cf6', // neon-purple
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        elementId: 'kosdaq'
    },
    nasdaq: {
        name: '나스닥',
        ticker: '^IXIC',
        color: '#ec4899', // neon-pink
        backgroundColor: 'rgba(236, 72, 153, 0.1)',
        elementId: 'nasdaq'
    },
    sp500: {
        name: 'S&P 500',
        ticker: '^GSPC',
        color: '#10b981', // positive green
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        elementId: 'sp500'
    }
};

function getKoreanName(ticker, englishName) {
    if (!ticker) return englishName || '';
    const cleanTicker = String(ticker).toUpperCase();
    
    let cleanName = englishName || '';
    if (cleanName.includes(',')) {
        const parts = cleanName.split(',');
        const firstPart = parts[0].trim();
        if (firstPart.toUpperCase() === cleanTicker || firstPart.toUpperCase().split('.')[0] === cleanTicker.split('.')[0]) {
            cleanName = '';
        } else {
            cleanName = firstPart;
        }
    }
    
    // Check ETF database first
    if (typeof ETF_DATABASE !== 'undefined' && ETF_DATABASE && ETF_DATABASE[cleanTicker]) {
        return ETF_DATABASE[cleanTicker].name;
    }
    
    // Hardcoded overrides first
    const translationMap = {
        'AAPL': '애플',
        'MSFT': '마이크로소프트',
        'NVDA': '엔비디아',
        'TSLA': '테슬라',
        'GOOGL': '구글 (Alphabet A)',
        'GOOG': '구글 (Alphabet C)',
        'AMZN': '아마존',
        'META': '메타',
        'NFLX': '넷플릭스',
        '005930.KS': '삼성전자',
        '005930': '삼성전자',
        '000660.KS': 'SK하이닉스',
        '000660': 'SK하이닉스',
        '035420.KS': 'NAVER',
        '035420': 'NAVER',
        '035720.KS': '카카오',
        '035720': '카카오',
        '005380.KS': '현대차',
        '005380': '현대차',
        '009150.KS': '삼성전기',
        '009150': '삼성전기',
        '373220.KS': 'LG에너지솔루션',
        '373220': 'LG에너지솔루션',
        '068270.KS': '셀트리온',
        '068270': '셀트리온',
        '354200.KS': '엔젠바이오',
        '354200.KQ': '엔젠바이오',
        '354200': '엔젠바이오',
        '^KS11': '코스피',
        'KOSPI': '코스피',
        '^KQ11': '코스닥',
        'KOSDAQ': '코스닥',
        '^IXIC': '나스닥',
        'NASDAQ': '나스닥',
        '^GSPC': 'S&P 500',
        'S&P 500': 'S&P 500'
    };

    if (translationMap[cleanTicker]) return translationMap[cleanTicker];
    
    const simpleKey = cleanTicker.split('.')[0];
    if (translationMap[simpleKey]) return translationMap[simpleKey];

    // Check cachedKoreanStocks database if loaded
    if (typeof cachedKoreanStocks !== 'undefined' && Array.isArray(cachedKoreanStocks) && cachedKoreanStocks.length > 0) {
        const found = cachedKoreanStocks.find(s => s.symbol.toUpperCase() === cleanTicker || s.symbol.split('.')[0].toUpperCase() === cleanTicker.split('.')[0]);
        if (found) return found.name;
    }

    // Check our POPULAR_STOCKS database if it exists
    if (typeof POPULAR_STOCKS !== 'undefined' && Array.isArray(POPULAR_STOCKS)) {
        const pop = POPULAR_STOCKS.find(s => s.symbol.toUpperCase() === cleanTicker || s.symbol.split('.')[0].toUpperCase() === cleanTicker.split('.')[0]);
        if (pop) return pop.name;
    }

    // Heuristics based on cleanName
    if (cleanName) {
        const lowerEng = cleanName.toLowerCase();
        if (lowerEng.includes('samsung electronics')) return '삼성전자';
        if (lowerEng.includes('sk hynix')) return 'SK하이닉스';
        if (lowerEng.includes('apple inc')) return '애플';
        if (lowerEng.includes('nvidia corp')) return '엔비디아';
        if (lowerEng.includes('tesla inc')) return '테슬라';
        if (lowerEng.includes('alphabet inc')) return '구글 / 알파벳';
        if (lowerEng.includes('microsoft')) return '마이크로소프트';
        if (lowerEng.includes('amazon.com')) return '아마존';
        if (lowerEng.includes('meta platforms')) return '메타';
        if (lowerEng.includes('netflix')) return '넷플릭스';
        
        return cleanName;
    }
    
    return ticker;
}

// Plugin to draw previous close line on 1D charts
const previousCloseLinePlugin = {
    id: 'previousCloseLine',
    afterDraw(chart, args, options) {
        if (!options || !options.enabled || options.value === undefined || options.value === null) return;
        const yAxis = chart.scales.y;
        if (!yAxis) return;
        
        const yVal = yAxis.getPixelForValue(options.value);
        if (yVal < chart.chartArea.top || yVal > chart.chartArea.bottom) return;
        
        const ctx = chart.ctx;
        ctx.save();
        
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        
        ctx.beginPath();
        ctx.moveTo(chart.chartArea.left, yVal);
        ctx.lineTo(chart.chartArea.right, yVal);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(options.label || 'Prev Close', chart.chartArea.right - 4, yVal - 2);
        
        ctx.restore();
    }
};

// Global chart options
const commonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { display: false },
        previousCloseLine: { enabled: false },
        tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(22, 30, 46, 0.9)',
            titleColor: '#f8fafc',
            bodyColor: '#f8fafc',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 10,
            displayColors: false,
            callbacks: {
                title: function(context) {
                    if (!context || !context.length) return '';
                    const rawTime = context[0].raw?.x;
                    if (rawTime) {
                        const d = new Date(rawTime);
                        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false});
                    }
                    return context[0].label;
                },
                label: function(context) {
                    const currentVal = context.raw?.y !== undefined ? context.raw.y : (context.raw?.c !== undefined ? context.raw.c : context.parsed?.y);
                    if (currentVal === undefined) return '';

                    const dataset = context.dataset;
                    const dataPoints = dataset.data;
                    if (!dataPoints || dataPoints.length === 0) return '';
                    
                    const firstPoint = dataPoints[0];
                    const startVal = firstPoint?.y !== undefined ? firstPoint.y : (firstPoint?.c !== undefined ? firstPoint.c : firstPoint);
                    
                    let pctHtml = '';
                    if (startVal !== undefined && startVal !== null && startVal !== 0) {
                        const pctChange = ((currentVal - startVal) / startVal) * 100;
                        const sign = pctChange >= 0 ? '+' : '';
                        pctHtml = ` (${sign}${pctChange.toFixed(2)}%)`;
                    }

                    let isIndex = false;
                    let isKrw = false;
                    let ticker = '';
                    const canvasId = context.chart?.canvas?.id;
                    if (canvasId) {
                        if (canvasId === 'modal-chart' && currentModalKey) {
                            const config = indices[currentModalKey];
                            if (config) ticker = config.ticker;
                        } else if (canvasId === 'expert-detail-chart' && typeof expertDetailTicker !== 'undefined' && expertDetailTicker) {
                            ticker = expertDetailTicker;
                        } else {
                            const key = canvasId.replace('-chart', '');
                            const config = indices[key];
                            if (config) ticker = config.ticker;
                        }
                        
                        if (ticker) {
                            isIndex = ticker.startsWith('^');
                            isKrw = ticker.endsWith('.KS') || ticker.endsWith('.KQ') || ticker === '^KS11' || ticker === '^KQ11';
                        }
                    }

                    const isKoreaIndex = ticker === '^KS11' || ticker === '^KQ11';
                    const formattedVal = new Intl.NumberFormat(isKrw ? 'ko-KR' : 'en-US', {
                        minimumFractionDigits: (isKrw && !isKoreaIndex) ? 0 : 2,
                        maximumFractionDigits: (isKrw && !isKoreaIndex) ? 0 : 2
                    }).format(currentVal);
                    
                    if (isIndex) {
                        return `${formattedVal}${pctHtml}`;
                    } else {
                        const prefix = isKrw ? '' : '$';
                        const suffix = isKrw ? '원' : '';
                        return `${prefix}${formattedVal}${suffix}${pctHtml}`;
                    }
                }
            }
        }
    },
    scales: {
        x: {
            type: 'timeseries',
            display: true,
            grid: {
                color: 'rgba(255, 255, 255, 0.05)',
                drawBorder: false,
            },
            ticks: {
                color: '#94a3b8',
                maxTicksLimit: 6,
                maxRotation: 0,
                autoSkip: true,
                font: {
                    family: "'Inter', sans-serif",
                    size: 10
                },
                callback: function(value, index, ticks) {
                    return formatChartLabel(new Date(ticks[index].value), currentRangeKey);
                }
            }
        },
        y: {
            display: true,
            position: 'right',
            grid: {
                color: 'rgba(255, 255, 255, 0.05)',
                drawBorder: false,
            },
            ticks: {
                color: '#94a3b8',
                font: {
                    family: "'Inter', sans-serif",
                    size: 11
                }
            }
        }
    },
    interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
    },
    elements: {
        point: {
            radius: 0,
            hitRadius: 10,
            hoverRadius: 4
        },
        line: {
            tension: 0.2
        }
    }
};

window.retryChart = async function(key) {
    const config = indices[key];
    if (document.getElementById(`${config.elementId}-price`)) {
        document.getElementById(`${config.elementId}-price`).textContent = 'Loading...';
    }
    await initSingleChart(key);
    if (currentModalKey === key && modalChartInstance) {
        openModal(key);
    }
};

const charts = {};
const lastTimestamps = {}; // Store last seen timestamp per chart

// Sleep helper to avoid rate limits
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Multiple CORS proxies to try in order
const CORS_PROXIES = [
    url => `https://images-focus-opensocial.googleusercontent.com/gadgets/proxy?container=focus&refresh=60&url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// Fetch a URL trying each proxy until one succeeds
async function fetchWithFallback(yahooUrl, timeoutMs = 6000) {
    for (const proxyFn of CORS_PROXIES) {
        const proxyUrl = proxyFn(yahooUrl);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            // Validate it looks like Yahoo Finance data
            if (data?.chart?.result?.length > 0) return data;
            throw new Error('Invalid data shape');
        } catch (e) {
            console.warn(`Proxy failed (${proxyUrl.split('?')[0]}):`, e.message);
        }
    }
    return null;
}

// Fetch data from Yahoo Finance via CORS proxy with retries
async function fetchRealData(ticker, rangeKey = '1d', retries = 3) {
    if (!ticker) {
        console.warn('fetchRealData: ticker is null or undefined.');
        return generateMockHistory('UNKNOWN', rangeKey);
    }
    const tickerStr = correctKoreanTicker(String(ticker));
    const rc = rangeConfig[rangeKey] || rangeConfig['1d'];
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const cacheBuster = `&_=${new Date().getTime()}`;
            const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${tickerStr}?interval=${rc.interval}&range=${rc.yahooRange}${cacheBuster}`;
            const data = await fetchWithFallback(yahooUrl, 6000);

            if (data && data.chart && data.chart.result && data.chart.result.length > 0) {
                const result = data.chart.result[0];
                const timestamps = result.timestamp;
                const quote = result.indicators?.quote?.[0] || {};
                const prices = quote.close;
                const opens = quote.open;
                const highs = quote.high;
                const lows = quote.low;
                const previousClose = result.meta?.previousClose || result.meta?.regularMarketPreviousClose || result.meta?.chartPreviousClose || 0;
                
                // Extract company name if available
                const companyName = result.meta?.shortName || result.meta?.longName || tickerStr;
                
                // Filter out null values
                let cleanData = [];
                if (timestamps && prices) {
                    for (let i = 0; i < timestamps.length; i++) {
                        if (prices[i] !== null && prices[i] !== undefined) {
                            cleanData.push({
                                time: new Date(timestamps[i] * 1000),
                                o: opens[i],
                                h: highs[i],
                                l: lows[i],
                                c: prices[i],
                                price: prices[i],
                                v: quote.volume ? quote.volume[i] : 0
                            });
                        }
                    }
                }
                
                if (cleanData.length > 0 && rc.filterLimit) {
                    const latestTime = cleanData[cleanData.length - 1].time.getTime();
                    cleanData = cleanData.filter(d => (latestTime - d.time.getTime()) <= rc.filterLimit);
                }
                
                return {
                    data: cleanData,
                    previousClose: previousClose,
                    companyName: companyName
                };
            }
        } catch (e) {
            console.error(`Attempt ${attempt + 1} failed for ${tickerStr}:`, e);
            if (attempt < retries - 1) await sleep(1000); // wait before retry
        }
    }
    
    // Fallback for any stock/index if Yahoo API fails
    const cleanTicker = tickerStr.toUpperCase();
    console.warn(`Yahoo Finance failed for ${tickerStr}, falling back to mock history.`);
    return generateMockHistory(cleanTicker, rangeKey);
}

// Format numbers
function formatPrice(price, isKrw, ticker = '') {
    const cleanTicker = String(ticker || '').toUpperCase();
    const isKoreaIndex = cleanTicker === '^KS11' || cleanTicker === '^KQ11' || cleanTicker === 'KOSPI' || cleanTicker === 'KOSDAQ';
    if (isKoreaIndex) {
        return new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
    }
    if (isKrw) {
        return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.round(price));
    }
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
}

function formatMAValue(val, isKRW) {
    if (val === null || val === undefined) return '-';
    if (isKRW) {
        return new Intl.NumberFormat('ko-KR').format(Math.round(val)) + '원';
    } else {
        return '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    }
}

function formatChange(change, percentChange, isKrw, ticker = '') {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${formatPrice(change, isKrw, ticker)} (${sign}${percentChange.toFixed(2)}%)`;
}

function formatItemPrice(price, isKrw) {
    if (price === 0) return 'Loading...';
    if (isKrw) {
        return new Intl.NumberFormat('ko-KR').format(Math.round(price)) + '원';
    } else {
        return '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
    }
}

function formatItemChange(price, prevClose, isKrw) {
    if (price === 0 || prevClose === 0) return '';
    const changeVal = price - prevClose;
    const changePct = (changeVal / prevClose) * 100;
    const absChange = Math.abs(changeVal);
    
    let formattedChange = '';
    if (isKrw) {
        formattedChange = new Intl.NumberFormat('ko-KR').format(Math.round(absChange)) + '원';
    } else {
        formattedChange = '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(absChange);
    }
    
    const percentSign = changePct >= 0 ? '+' : '';
    const colorClass = changeVal > 0 ? 'positive' : (changeVal < 0 ? 'negative' : '');
    const arrow = changeVal > 0 ? '▲' : (changeVal < 0 ? '▼' : '');
    const sign = changeVal > 0 ? '+' : (changeVal < 0 ? '-' : '');
    
    return `<span class="${colorClass}" style="font-weight: 500;">
        ${arrow} ${sign}${formattedChange} (${percentSign}${changePct.toFixed(2)}%)
    </span>`;
}

// Update DOM elements
function updateDOM(key, price, previousClose) {
    const config = indices[key];
    if (!config) {
        console.warn(`updateDOM: no config found for key ${key}`);
        return;
    }
    const change = price - previousClose;
    const percentChange = (change / previousClose) * 100;
    
    const priceEl = document.getElementById(`${config.elementId}-price`);
    const changeEl = document.getElementById(`${config.elementId}-change`);
    
    const ticker = config.ticker || '';
    const isKrw = ticker.endsWith('.KS') || ticker.endsWith('.KQ') || ticker === '^KS11' || ticker === '^KQ11';
    
    if (priceEl) priceEl.textContent = formatPrice(price, isKrw, ticker);
    if (changeEl) {
        changeEl.textContent = formatChange(change, percentChange, isKrw, ticker);
        if (change >= 0) {
            changeEl.classList.remove('negative');
            changeEl.classList.add('positive');
            changeEl.innerHTML = `▲ ${changeEl.textContent}`;
        } else {
            changeEl.classList.remove('positive');
            changeEl.classList.add('negative');
            changeEl.innerHTML = `▼ ${changeEl.textContent}`;
        }
    }
}

const neonColors = [
    { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
    { color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },
    { color: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' },
    { color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
    { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
    { color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)' }
];

// Modal Variables
let modalChartInstance = null;
let currentModalKey = null;
let expertDetailChartInstance = null;
let expertDetailChartRange = '1d';
let expertDetailTicker = null;

// Modal Functions
function openModal(key) {
    currentModalKey = key;
    const config = indices[key];
    if (!config) {
        console.warn(`openModal: no config found for key ${key}`);
        return;
    }
    const chartData = charts[key];
    
    if (!chartData) return; // chart not ready

    const modalOverlay = document.getElementById('chart-modal');
    const koreanTitle = getKoreanName(config.ticker, config.companyName || config.name);
    const showTicker = !config.ticker.startsWith('^');
    document.getElementById('modal-title').innerHTML = showTicker ? `${koreanTitle} <span class="card-ticker">(${config.ticker})</span>` : koreanTitle;
    document.getElementById('modal-company-name').textContent = config.companyName || config.name;
    
    // Copy price and change from the card
    const priceEl = document.getElementById(`${config.elementId}-price`);
    const changeEl = document.getElementById(`${config.elementId}-change`);
    const modalPrice = document.getElementById('modal-price');
    const modalChange = document.getElementById('modal-change');
    
    modalPrice.textContent = priceEl.textContent;
    modalChange.innerHTML = changeEl.innerHTML;
    modalChange.className = changeEl.className; // copy positive/negative classes

    const modalCanvas = document.getElementById('modal-chart');
    if (!modalCanvas) return;
    const ctx = modalCanvas.getContext('2d');
    if (!ctx) return;
    
    if (modalChartInstance) {
        modalChartInstance.destroy();
    }

    let modalDatasetOptions = { ...chartData.data.datasets[0] };
    modalDatasetOptions.data = [...chartData.data.datasets[0].data];
    
    if (currentChartType === 'line') {
        modalDatasetOptions.borderWidth = 3;
        modalDatasetOptions.pointRadius = 0;
        modalDatasetOptions.pointHitRadius = 10;
        modalDatasetOptions.pointHoverRadius = 6;
    }

    const isKrw = config.ticker.endsWith('.KS') || config.ticker.endsWith('.KQ') || config.ticker === '^KS11' || config.ticker === '^KQ11';
    const formattedPrevClose = (config.previousClose !== undefined && config.previousClose !== null) ? formatPrice(config.previousClose, isKrw, config.ticker) : '';

    const smallChart = charts[key];
    let modalYScaleConfig = {};
    if (smallChart && smallChart.options.scales && smallChart.options.scales.y) {
        modalYScaleConfig.min = smallChart.options.scales.y.min;
        modalYScaleConfig.max = smallChart.options.scales.y.max;
    }

    // Clone the datasets and labels so it mirrors the small chart
    modalChartInstance = new Chart(ctx, {
        type: currentChartType === 'candlestick' ? 'candlestick' : 'line',
        data: {
            datasets: [modalDatasetOptions]
        },
        options: {
            ...commonChartOptions,
            plugins: {
                ...commonChartOptions.plugins,
                tooltip: {
                    ...commonChartOptions.plugins.tooltip,
                    bodyFont: { size: 14 },
                    titleFont: { size: 14 }
                },
                previousCloseLine: {
                    enabled: currentRangeKey === '1d' && config.previousClose !== undefined && config.previousClose !== null,
                    value: config.previousClose,
                    label: `전일종가: ${formattedPrevClose}`
                }
            },
            scales: {
                ...commonChartOptions.scales,
                x: {
                    ...commonChartOptions.scales.x,
                    ticks: { ...commonChartOptions.scales.x.ticks, maxTicksLimit: 10 }
                },
                y: {
                    ...commonChartOptions.scales.y,
                    ticks: { color: '#94a3b8', font: { size: 14 } },
                    min: modalYScaleConfig.min,
                    max: modalYScaleConfig.max
                }
            }
        },
        plugins: [previousCloseLinePlugin]
    });

    modalOverlay.classList.add('active');
}

function closeModal() {
    document.getElementById('chart-modal').classList.remove('active');
    currentModalKey = null;
}




// Add click listeners to existing cards
function setupCardClickListeners() {
    document.querySelectorAll('.chart-card').forEach(card => {
        card.addEventListener('click', () => {
            const key = card.getAttribute('data-key');
            if (key) openModal(key);
        });
    });
}

async function initSingleChart(key) {
    const config = indices[key];
    if (!config) {
        console.warn(`initSingleChart: no config found for key ${key}`);
        return false;
    }
    const canvas = document.getElementById(`${config.elementId}-chart`);
    if (!canvas) return false;
    
    let ctx = canvas.getContext('2d');
    if (!ctx) {
        console.warn(`initSingleChart: could not get 2d context for canvas.`);
        return false;
    }

    // Show loading state
    if (document.getElementById(`${config.elementId}-price`)) {
        document.getElementById(`${config.elementId}-price`).textContent = 'Loading...';
    }

    const apiResult = await fetchRealData(config.ticker, currentRangeKey);
    
    // Check if the chart was removed or logged out during the await
    const currentCanvas = document.getElementById(`${config.elementId}-chart`);
    if (!indices[key] || !currentCanvas) {
        console.warn(`initSingleChart: chart for ${key} was removed during fetch.`);
        return false;
    }
    const currentCtx = currentCanvas.getContext('2d');
    if (!currentCtx) {
        console.warn(`initSingleChart: context for ${key} is invalid.`);
        return false;
    }
    ctx = currentCtx;
    
    if (!apiResult || apiResult.data.length === 0) {
        document.getElementById(`${config.elementId}-price`).innerHTML = `Failed <button class="reload-btn" onclick="retryChart('${key}')" title="Reload">&#x21bb;</button>`;
        if (charts[key]) {
            charts[key].destroy();
            charts[key] = null;
        }
        return false;
    }

    const allData = apiResult.data;
    
    const latestPrice = allData[allData.length - 1].price;
    lastTimestamps[key] = allData[allData.length - 1].time.getTime();
    config.previousClose = apiResult.previousClose;
    config.companyName = apiResult.companyName;

    // Dynamically calculate color based on change compared to previous close
    const change = latestPrice - config.previousClose;
    const isPositive = change >= 0;
    const activeColor = isPositive ? '#ef4444' : '#3b82f6';
    const activeBgColor = isPositive ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)';

    const gradient = ctx.createLinearGradient(0, 0, 0, 250);
    gradient.addColorStop(0, activeBgColor);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    // Update company name DOM if element exists
    const nameEl = document.getElementById(`${config.elementId}-name`);
    if (nameEl) nameEl.textContent = config.companyName;

    // Dynamically update the card header to include the Report button with the real company name
    const titleEl = document.querySelector(`.chart-card[data-key="${key}"] h2`);
    if (titleEl) {
        const safeCompanyName = config.companyName ? config.companyName.replace(/'/g, "\\'") : config.name;
        const koreanTitle = getKoreanName(config.ticker, config.companyName);
        const showTicker = !config.ticker.startsWith('^');
        const displayTitle = showTicker ? `${koreanTitle} <span class="card-ticker">(${config.ticker})</span>` : koreanTitle;
        
        titleEl.innerHTML = displayTitle;

        const headerLeftEl = document.querySelector(`.chart-card[data-key="${key}"] .header-left`);
        if (headerLeftEl) {
            const oldButtons = headerLeftEl.querySelector('.card-buttons-row');
            if (oldButtons) oldButtons.remove();
            
            if (showTicker) {
                const pfButtonHtml = getPortfolioButtonHtml(key, config.ticker);
                const buttonHtml = `
                    <span class="card-buttons-row">
                        <button class="expert-analysis-btn" onclick="event.stopPropagation(); analyzeStockForDashboard('${config.ticker}')" title="고수 Pick 분석">고수Pick</button>
                        ${pfButtonHtml}
                    </span>
                `;
                headerLeftEl.insertAdjacentHTML('beforeend', buttonHtml);
            }
        }
    }

    if (charts[key]) {
        charts[key].destroy();
    }

    let datasetOptions = {};
    if (currentChartType === 'candlestick') {
        const candleData = allData.map(d => ({
            x: d.time.valueOf(),
            o: d.o,
            h: d.h,
            l: d.l,
            c: d.c
        }));
        datasetOptions = {
            label: config.name,
            data: candleData,
            color: {
                up: 'rgba(16, 185, 129, 0.8)',
                down: 'rgba(239, 68, 68, 0.8)',
                unchanged: 'rgba(148, 163, 184, 0.8)',
            },
            borderColor: {
                up: '#10b981',
                down: '#ef4444',
                unchanged: '#94a3b8',
            },
            borderWidth: 1
        };
    } else {
        const lineData = allData.map(d => ({
            x: d.time.valueOf(),
            y: d.c
        }));
        datasetOptions = {
            label: config.name,
            data: lineData,
            borderColor: activeColor,
            backgroundColor: gradient,
            borderWidth: 2,
            fill: true,
            tension: 0.2,
            pointRadius: 0,
            pointHitRadius: 10,
            pointHoverRadius: 4
        };
    }

    const isKrw = config.ticker.endsWith('.KS') || config.ticker.endsWith('.KQ') || config.ticker === '^KS11' || config.ticker === '^KQ11';
    const formattedPrevClose = (config.previousClose !== undefined && config.previousClose !== null) ? formatPrice(config.previousClose, isKrw, config.ticker) : '';

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    allData.forEach(d => {
        const val = d.c !== null && d.c !== undefined ? d.c : d.price;
        if (val < minPrice) minPrice = val;
        if (val > maxPrice) maxPrice = val;
    });

    const is1D = currentRangeKey === '1d';
    const prevClose = config.previousClose;
    let yScaleConfig = {};

    if (is1D && prevClose !== undefined && prevClose !== null && prevClose > 0) {
        let yMin = minPrice;
        let yMax = maxPrice;
        if (prevClose < yMin) {
            yMin = prevClose;
        }
        if (prevClose > yMax) {
            yMax = prevClose;
        }
        const pad = (yMax - yMin) * 0.03 || yMin * 0.005;
        yScaleConfig = {
            min: yMin - pad,
            max: yMax + pad
        };
    }

    charts[key] = new Chart(ctx, {
        type: currentChartType === 'candlestick' ? 'candlestick' : 'line',
        data: {
            datasets: [datasetOptions]
        },
        options: {
            ...commonChartOptions,
            plugins: {
                ...commonChartOptions.plugins,
                previousCloseLine: {
                    enabled: currentRangeKey === '1d' && config.previousClose !== undefined && config.previousClose !== null,
                    value: config.previousClose,
                    label: `전일종가: ${formattedPrevClose}`
                }
            },
            scales: {
                ...commonChartOptions.scales,
                y: {
                    ...commonChartOptions.scales.y,
                    ...yScaleConfig
                }
            }
        },
        plugins: [previousCloseLinePlugin]
    });

    updateDOM(key, latestPrice, config.previousClose);
    return true;
}

// Initialize all charts
async function initCharts() {
    // Restore saved search cards on load to guarantee they stay visible on refresh (e.g. CTRL-F5)
    await ensureKoreanStocks();
    let savedSearches = JSON.parse(localStorage.getItem('recent_searches')) || [];
    let correctedSearches = [];
    let modified = false;
    for (const ticker of savedSearches) {
        const corrected = correctKoreanTicker(ticker);
        if (corrected !== ticker) {
            console.log(`Auto-correcting saved search ticker in initCharts from ${ticker} to ${corrected}`);
            modified = true;
        }
        correctedSearches.push(corrected);
    }
    if (modified) {
        localStorage.setItem('recent_searches', JSON.stringify(correctedSearches));
    }

    for (const ticker of correctedSearches) {
        if (!Object.values(indices).some(idx => idx.ticker === ticker)) {
            const key = `custom_${ticker.replace(/[^A-Z0-9]/g, '')}`;
            const randomColor = neonColors[Math.floor(Math.random() * neonColors.length)];

            indices[key] = {
                name: ticker,
                ticker: ticker,
                color: randomColor.color,
                backgroundColor: randomColor.bg,
                elementId: key
            };

            const container = document.querySelector('.dashboard-container');
            if (container) {
                const koreanTitle = getKoreanName(ticker, '');
                const showTicker = !ticker.startsWith('^');
                const displayTitle = showTicker ? `${koreanTitle} <span class="card-ticker">(${ticker})</span>` : koreanTitle;
                const cardHTML = `
                    <div class="glass-card chart-card" data-key="${key}" draggable="true">
                        <div class="card-header">
                            <div class="header-left">
                                <h2>${displayTitle}</h2>
                                <span class="company-name" id="${key}-name">Loading...</span>
                            </div>
                            <div class="header-right">
                                <div class="price-container">
                                    <span class="price" id="${key}-price">Loading...</span>
                                    <span class="change" id="${key}-change">--</span>
                                </div>
                                <button class="remove-chart-btn" onclick="event.stopPropagation(); removeChart('${key}')" title="Remove Chart">&times;</button>
                            </div>
                        </div>
                        <div class="chart-container">
                            <canvas id="${key}-chart"></canvas>
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', cardHTML);

                // Add click listener
                const newCard = container.lastElementChild;
                newCard.addEventListener('click', () => openModal(key));
            }
        }
    }

    // Bind drag and drop events
    setupDragAndDropListeners();

    // Load default and custom charts
    for (const key of Object.keys(indices)) {
        await initSingleChart(key);
        await sleep(400); // reduced delay for slightly snappier startup
    }
}

// Update charts with new data every 10 seconds to avoid heavy rate limiting
function startRealtimeUpdates() {
    setInterval(async () => {
        for (const key of Object.keys(indices)) {
            const config = indices[key];
            if (!config) continue;
            let chart = charts[key];
            
            // Auto-reload: If the chart failed to initialize previously, try to initialize it now
            if (!chart) {
                const priceEl = document.getElementById(`${config.elementId}-price`);
                if (priceEl) priceEl.textContent = 'Retrying...';
                await initSingleChart(key);
                await sleep(500); // stagger updates
                continue; // Skip the regular update for this cycle since it was just initialized
            }

            const apiResult = await fetchRealData(config.ticker, currentRangeKey, 1); // 1 retry for realtime updates
            
            // Check if the chart was destroyed or deleted during the await
            if (!indices[key] || !charts[key] || !chart || !chart.ctx) {
                continue;
            }
            
            if (!apiResult || apiResult.data.length === 0) continue;

            const latestPoint = apiResult.data[apiResult.data.length - 1];
            const latestTimeStr = formatChartLabel(latestPoint.time, currentRangeKey);
            const latestTimestamp = latestPoint.time.getTime();

            // Only update chart if we received a newer data point
            if (latestTimestamp > lastTimestamps[key]) {
                lastTimestamps[key] = latestTimestamp;

                if (chart.data && chart.data.datasets && chart.data.datasets[0] && chart.data.datasets[0].data) {
                    if (currentChartType === 'candlestick') {
                        chart.data.datasets[0].data.push({
                            x: latestTimestamp,
                            o: latestPoint.o,
                            h: latestPoint.h,
                            l: latestPoint.l,
                            c: latestPoint.c
                        });
                    } else {
                        chart.data.datasets[0].data.push({
                            x: latestTimestamp,
                            y: latestPoint.c
                        });
                    }
                }

                if (chart.data && chart.data.datasets && chart.data.datasets[0] && chart.data.datasets[0].data && chart.data.datasets[0].data.length > 1000) {
                    chart.data.datasets[0].data.shift();
                }
            } else if (latestTimestamp === lastTimestamps[key]) {
                if (chart.data && chart.data.datasets && chart.data.datasets[0] && chart.data.datasets[0].data && chart.data.datasets[0].data.length > 0) {
                    const lastIdx = chart.data.datasets[0].data.length - 1;
                    if (currentChartType === 'candlestick') {
                        chart.data.datasets[0].data[lastIdx] = {
                            x: latestTimestamp,
                            o: latestPoint.o,
                            h: latestPoint.h,
                            l: latestPoint.l,
                            c: latestPoint.c
                        };
                    } else {
                        chart.data.datasets[0].data[lastIdx] = {
                            x: latestTimestamp,
                            y: latestPoint.c
                        };
                    }
                }
            }
            
            // Dynamically update chart line color based on price change
            const isPositive = (latestPoint.price - config.previousClose) >= 0;
            const activeColor = isPositive ? '#ef4444' : '#3b82f6';
            const activeBgColor = isPositive ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)';
            
            const chartCtx = chart.ctx;
            if (!chartCtx) continue;
            const newGradient = chartCtx.createLinearGradient(0, 0, 0, 250);
            newGradient.addColorStop(0, activeBgColor);
            newGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            
            if (chart.data && chart.data.datasets && chart.data.datasets[0]) {
                if (currentChartType !== 'candlestick') {
                    chart.data.datasets[0].borderColor = activeColor;
                    chart.data.datasets[0].backgroundColor = newGradient;
                }
            }
            
            chart.update('none');

            // Always update UI to ensure it reflects latest status
            updateDOM(key, latestPoint.price, config.previousClose);
            
            // If modal is open for this chart, update it too
            if (currentModalKey === key && modalChartInstance && modalChartInstance.ctx) {
                const modalPrice = document.getElementById('modal-price');
                const modalChange = document.getElementById('modal-change');
                const priceEl = document.getElementById(`${config.elementId}-price`);
                const changeEl = document.getElementById(`${config.elementId}-change`);
                
                if (modalPrice && priceEl) modalPrice.textContent = priceEl.textContent;
                if (modalChange && changeEl) {
                    modalChange.innerHTML = changeEl.innerHTML;
                    modalChange.className = changeEl.className;
                }
                
                if (chart.data && chart.data.datasets && chart.data.datasets[0] && chart.data.datasets[0].data &&
                    modalChartInstance.data && modalChartInstance.data.datasets && modalChartInstance.data.datasets[0]) {
                    modalChartInstance.data.datasets[0].data = [...chart.data.datasets[0].data];
                    
                    if (currentChartType !== 'candlestick') {
                        const modalCtx = modalChartInstance.ctx;
                        if (modalCtx) {
                            const modalGradient = modalCtx.createLinearGradient(0, 0, 0, 250);
                            modalGradient.addColorStop(0, activeBgColor);
                            modalGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                            
                            modalChartInstance.data.datasets[0].borderColor = activeColor;
                            modalChartInstance.data.datasets[0].backgroundColor = modalGradient;
                        }
                    }
                    
                    modalChartInstance.update('none');
                }
            }
            
            await sleep(500); // stagger updates
        }
    }, 10000); // poll every 10 seconds instead of 2 to be safe
}

// Ensure local full stock database is loaded
async function ensureKoreanStocks() {
    if (cachedKoreanStocks && cachedKoreanStocks.length > 0) {
        return cachedKoreanStocks;
    }
    try {
        const response = await fetch('korean_stocks.json');
        if (response.ok) {
            cachedKoreanStocks = await response.json();
            return cachedKoreanStocks;
        }
    } catch (e) {
        console.error("Failed to load korean_stocks.json:", e);
    }
    cachedKoreanStocks = [];
    return cachedKoreanStocks;
}

// Correct incorrect Korean ticker suffixes using cachedKoreanStocks database
function correctKoreanTicker(ticker) {
    if (!ticker) return ticker;
    const tickerStr = String(ticker).toUpperCase().trim();
    const match = tickerStr.match(/^(\d{6})(\.(KS|KQ))?$/);
    if (match) {
        const code = match[1];
        if (cachedKoreanStocks && Array.isArray(cachedKoreanStocks) && cachedKoreanStocks.length > 0) {
            const found = cachedKoreanStocks.find(s => s.symbol.split('.')[0] === code);
            if (found) {
                return found.symbol.toUpperCase();
            }
        }
        if (typeof POPULAR_STOCKS !== 'undefined') {
            const found = POPULAR_STOCKS.find(s => s.symbol.split('.')[0] === code);
            if (found) {
                return found.symbol.toUpperCase();
            }
        }
    }
    return ticker;
}

// Add custom chart dynamically
function resolveTicker(ticker) {
    ticker = ticker.trim().toUpperCase();
    if (!ticker) return '';
    
    // Auto-correct Korean tickers if possible
    ticker = correctKoreanTicker(ticker);
    
    // If it already has an extension (like .KS, .KQ, =X, ^IXIC etc.), keep it as is
    if (ticker.includes('.') || ticker.includes('=') || ticker.startsWith('^')) {
        return ticker;
    }
    
    // If it's a 6-digit number, it's a Korean stock/ETF
    if (/^\d{6}$/.test(ticker)) {
        // Look up in POPULAR_STOCKS
        if (typeof POPULAR_STOCKS !== 'undefined') {
            const found = POPULAR_STOCKS.find(s => s.symbol.startsWith(ticker) || s.symbol.split('.')[0] === ticker);
            if (found) {
                return found.symbol;
            }
        }
        // Fallback default: KOSPI (.KS)
        return ticker + '.KS';
    }
    
    // Otherwise, assume it's US market (NASDAQ/NYSE)
    return ticker;
}

// Add custom chart dynamically
async function handleAddChart() {
    const input = document.getElementById('ticker-input');
    let rawTicker = input.value.trim();
    if (!rawTicker) return;

    let ticker = resolveTicker(rawTicker);
    if (!ticker) return;

    // Check if already exists
    if (Object.values(indices).some(idx => idx.ticker === ticker)) {
        alert('Ticker already exists!');
        return;
    }

    const key = `custom_${ticker.replace(/[^A-Z0-9]/g, '')}`;
    const randomColor = neonColors[Math.floor(Math.random() * neonColors.length)];

    // Register
    indices[key] = {
        name: ticker,
        ticker: ticker,
        color: randomColor.color,
        backgroundColor: randomColor.bg,
        elementId: key
    };

    // Create DOM element
    const container = document.querySelector('.dashboard-container');
    const koreanTitle = getKoreanName(ticker, '');
    const showTicker = !ticker.startsWith('^');
    const displayTitle = showTicker ? `${koreanTitle} <span class="card-ticker">(${ticker})</span>` : koreanTitle;
    const cardHTML = `
        <div class="glass-card chart-card" data-key="${key}" draggable="true">
            <div class="card-header">
                <div class="header-left">
                    <h2>${displayTitle}</h2>
                    <span class="company-name" id="${key}-name">Loading...</span>
                </div>
                <div class="header-right">
                    <div class="price-container">
                        <span class="price" id="${key}-price">Loading...</span>
                        <span class="change" id="${key}-change">--</span>
                    </div>
                    <button class="remove-chart-btn" onclick="event.stopPropagation(); removeChart('${key}')" title="Remove Chart">&times;</button>
                </div>
            </div>
            <div class="chart-container">
                <canvas id="${key}-chart"></canvas>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', cardHTML);
    
    // Add click listener to the newly created card
    const newCard = container.lastElementChild;
    newCard.addEventListener('click', () => openModal(key));
    
    // Clear input
    input.value = '';

    // Init chart
    const success = await initSingleChart(key);
    if (success) {
        // Record search history
        if (!recentSearches.includes(ticker)) {
            recentSearches.unshift(ticker);
            if (recentSearches.length > 10) recentSearches.pop();
        }

        // Report button is dynamically registered by initSingleChart

        // Sync to Google Drive if logged in (Commented out to disable real-time auto sync per user request)
        // if (googleAccessToken) {
        //     syncDataToGoogleDrive();
        // }
    } else {
        alert(`Failed to load data for ${ticker}. Please check if the ticker is correct.`);
    }
}

window.removeChart = function(key) {
    if (!confirm('해당 차트를 삭제하시겠습니까?')) return;

    const config = indices[key];
    if (!config) return;

    // Remove from DOM
    const card = document.querySelector(`.chart-card[data-key="${key}"]`);
    if (card) {
        card.remove();
    }

    // Clean up chart instance
    if (charts[key]) {
        charts[key].destroy();
        delete charts[key];
    }

    // Remove from recent searches
    const ticker = config.ticker;
    const searchIdx = recentSearches.indexOf(ticker);
    if (searchIdx > -1) {
        recentSearches.splice(searchIdx, 1);
    }

    // Remove from indices
    delete indices[key];

    console.log(`Chart ${key} removed.`);

    // Sync to Google Drive if logged in (Commented out to disable real-time auto sync per user request)
    // if (googleAccessToken) {
    //     syncDataToGoogleDrive();
    // }
};

// ==========================================
// Portfolio and Backtesting Logic
// ==========================================

let portfolio = [];
let activePortfolioItemKey = null;
let portfolioDonutChart = null;
let exchangeRate = 1350; // Fallback USD/KRW

window.addToPortfolio = function(key) {
    const config = indices[key];
    const existing = portfolio.find(p => p.key === key);
    if (!existing) {
        portfolio.push({
            key: key,
            ticker: config.ticker,
            name: config.name,
            companyName: config.companyName || config.name,
            quantity: 0
        });
        savePortfolio();
        updateDashboardPortfolioButtons();
        alert(`${config.name} added to portfolio!`);
    } else {
        alert(`${config.name} is already in your portfolio.`);
    }
};

function savePortfolio() {
    // Disabled local caching per user request. Use manual cloud sync-btn instead.
}

function getPortfolioButtonHtml(key, ticker) {
    const pfItem = portfolio.find(p => p.key === key || p.ticker === ticker);
    if (pfItem) {
        return `<span class="portfolio-status-badge">보유중(${pfItem.quantity})</span>`;
    } else {
        return `<button class="portfolio-add-btn" onclick="event.stopPropagation(); addToPortfolio('${key}')" title="My Portfolio에 추가">+ Portfolio</button>`;
    }
}

function updateDashboardPortfolioButtons() {
    for (const key of Object.keys(indices)) {
        const config = indices[key];
        const cardEl = document.querySelector(`.chart-card[data-key="${key}"]`);
        if (!cardEl) continue;

        const showTicker = !config.ticker.startsWith('^');
        if (!showTicker) continue;

        const addBtn = cardEl.querySelector('.portfolio-add-btn');
        const statusBadge = cardEl.querySelector('.portfolio-status-badge');

        const newHtml = getPortfolioButtonHtml(key, config.ticker);
        
        if (statusBadge) {
            statusBadge.outerHTML = newHtml;
        } else if (addBtn) {
            addBtn.outerHTML = newHtml;
        }
    }
}

async function fetchExchangeRate() {
    const apiResult = await fetchRealData('KRW=X', '1d', 1);
    if (apiResult && apiResult.data.length > 0) {
        exchangeRate = apiResult.data[apiResult.data.length - 1].price;
    }
}

let currentPortfolioPrices = {};
let currentPortfolioPrevCloses = {};
let isBackgroundFetching = false;

function renderPortfolio() {
    activePortfolioItemKey = null;
    const list = document.getElementById('portfolio-list');
    list.innerHTML = '';
    
    let totalKrw = 0;
    let totalPrevCloseKrw = 0;
    let allLoaded = true;
    
    // Sort copy of portfolio by asset valuation (itemTotalKrw) descending
    const sortedPortfolio = [...portfolio].map(item => {
        let price = currentPortfolioPrices[item.key] || 0;
        if (charts[item.key] && charts[item.key].data.datasets[0].data.length > 0) {
            const chartData = charts[item.key].data.datasets[0].data;
            const lastData = chartData[chartData.length - 1];
            price = lastData.y !== undefined ? lastData.y : lastData.c;
        }
        let isKrw = item.ticker.endsWith('.KS') || item.ticker.endsWith('.KQ') || item.ticker === '^KS11' || item.ticker === '^KQ11';
        const itemTotal = price * item.quantity;
        const itemTotalKrw = isKrw ? itemTotal : itemTotal * exchangeRate;
        return { item, valKrw: itemTotalKrw };
    }).sort((a, b) => b.valKrw - a.valKrw);
    
    for (const { item, valKrw } of sortedPortfolio) {
        let price = currentPortfolioPrices[item.key] || 0;
        let prevClose = currentPortfolioPrevCloses[item.key] || (indices[item.key] ? indices[item.key].previousClose : 0) || price || 0;
        
        // Synchronously check if chart has price
        if (charts[item.key] && charts[item.key].data.datasets[0].data.length > 0) {
            const chartData = charts[item.key].data.datasets[0].data;
            const lastData = chartData[chartData.length - 1];
            price = lastData.y !== undefined ? lastData.y : lastData.c;
            currentPortfolioPrices[item.key] = price;
            if (indices[item.key] && indices[item.key].previousClose) {
                prevClose = indices[item.key].previousClose;
                currentPortfolioPrevCloses[item.key] = prevClose;
            }
        }
        
        if (price === 0) allLoaded = false;
        
        let isKrw = item.ticker.endsWith('.KS') || item.ticker.endsWith('.KQ') || item.ticker === '^KS11' || item.ticker === '^KQ11';
        
        const itemTotalKrw = valKrw;
        totalKrw += itemTotalKrw;
        
        if (price > 0 && prevClose > 0) {
            const itemPrevTotal = prevClose * item.quantity;
            const itemPrevTotalKrw = isKrw ? itemPrevTotal : itemPrevTotal * exchangeRate;
            totalPrevCloseKrw += itemPrevTotalKrw;
        }
        
        const config = indices[item.key] || {};
        const displayCompanyName = getKoreanName(item.ticker, config.companyName || item.companyName || item.name);
        
        // Calculate change percent and arrow for rendering
        let changeVal = price - prevClose;
        let changePct = prevClose > 0 ? (changeVal / prevClose) * 100 : 0;
        let arrow = changeVal > 0 ? '▲' : (changeVal < 0 ? '▼' : '');
        let colorClass = changeVal > 0 ? 'positive' : (changeVal < 0 ? 'negative' : '');
        
        const div = document.createElement('div');
        div.className = 'portfolio-item';
        div.setAttribute('data-key', item.key);
        div.setAttribute('data-val-krw', itemTotalKrw);
        div.innerHTML = `
            <div class="pt-left-group">
                <div class="pt-icon-badge">💼</div>
                <div class="pt-name-ticker-group">
                    <span class="pt-name" id="pt-name-${item.key}">${displayCompanyName} <span class="pt-ticker" style="margin-left: 0.25rem;">${item.ticker}</span></span>
                    <div class="pt-ticker-price-row">
                        <span id="pt-price-${item.key}">${formatItemPrice(price, isKrw)}</span>
                        <span id="pt-change-${item.key}" class="pt-item-price-change ${colorClass}">
                            ${arrow} ${Math.abs(changePct).toFixed(2)}%
                        </span>
                    </div>
                </div>
            </div>
            
            <div class="pt-qty-spin-container">
                <button class="pt-qty-btn minus" data-key="${item.key}">−</button>
                <input type="number" class="pt-quantity" value="${item.quantity}" min="0" step="1" data-key="${item.key}">
                <button class="pt-qty-btn plus" data-key="${item.key}">+</button>
            </div>
            
            <div class="pt-valuation-block">
                <span class="pt-valuation-label">평가액</span>
                <span class="pt-val ${colorClass}" id="pt-val-${item.key}">
                    ${price === 0 ? 'Loading...' : new Intl.NumberFormat('ko-KR').format(Math.round(itemTotalKrw)) + '원'}
                </span>
            </div>
            
            <button class="pt-delete" data-key="${item.key}" title="Delete">&times;</button>
        `;
        list.appendChild(div);
    }
    
    // Update Totals and summary stats
    updatePortfolioTotals();
    
    // Add Event Listeners for quantity spin buttons (+/-)
    document.querySelectorAll('.pt-qty-btn.minus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.currentTarget.getAttribute('data-key');
            const input = e.currentTarget.nextElementSibling;
            let qty = parseFloat(input.value) || 0;
            qty = Math.max(0, qty - 1);
            input.value = qty;
            
            // Programmatically focus the input to prevent sorting during rapid adjustments
            input.focus();
            
            const item = portfolio.find(p => p.key === key);
            if (item) {
                item.quantity = qty;
                savePortfolio();
                updatePortfolioTotals();
                updateDashboardPortfolioButtons();
            }
        });
    });
    
    document.querySelectorAll('.pt-qty-btn.plus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.currentTarget.getAttribute('data-key');
            const input = e.currentTarget.previousElementSibling;
            let qty = parseFloat(input.value) || 0;
            qty = qty + 1;
            input.value = qty;
            
            // Programmatically focus the input to prevent sorting during rapid adjustments
            input.focus();
            
            const item = portfolio.find(p => p.key === key);
            if (item) {
                item.quantity = qty;
                savePortfolio();
                updatePortfolioTotals();
                updateDashboardPortfolioButtons();
            }
        });
    });
    
    // Add Event Listener for input changes inside spinner
    document.querySelectorAll('.pt-quantity').forEach(input => {
        input.addEventListener('input', (e) => {
            const key = e.target.getAttribute('data-key');
            let qty = parseFloat(e.target.value);
            if (isNaN(qty) || qty < 0) qty = 0;
            
            const item = portfolio.find(p => p.key === key);
            if (item) {
                item.quantity = qty;
                savePortfolio();
                updatePortfolioTotals();
                updateDashboardPortfolioButtons();
            }
        });
    });
    
    // Add Event Listener for delete button
    document.querySelectorAll('.pt-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.currentTarget.getAttribute('data-key');
            portfolio = portfolio.filter(p => p.key !== key);
            savePortfolio();
            renderPortfolio();
            updateDashboardPortfolioButtons();
        });
    });
    
    // Kick off background fetch for missing data
    backgroundFetchPortfolioData();
}

async function backgroundFetchPortfolioData() {
    if (isBackgroundFetching) return;
    isBackgroundFetching = true;
    
    try {
        await fetchExchangeRate();
        
        for (const item of portfolio) {
            if (charts[item.key] && charts[item.key].data.datasets[0].data.length > 0) {
                continue; // Already got it synchronously
            }
            
            if (!currentPortfolioPrices[item.key]) {
                const apiResult = await fetchRealData(item.ticker, '1d', 1);
                if (apiResult && apiResult.data.length > 0) {
                    currentPortfolioPrices[item.key] = apiResult.data[apiResult.data.length - 1].price;
                    currentPortfolioPrevCloses[item.key] = apiResult.previousClose || 0;
                    if (apiResult.companyName && !item.companyName) {
                        item.companyName = apiResult.companyName;
                        savePortfolio();
                        const nameDiv = document.getElementById(`pt-name-${item.key}`);
                        if (nameDiv) {
                            const displayCompanyName = getKoreanName(item.ticker, item.companyName);
                            nameDiv.innerHTML = `${displayCompanyName} <span class="pt-ticker" style="margin-left: 0.25rem;">${item.ticker}</span>`;
                        }
                    }
                } else {
                    currentPortfolioPrices[item.key] = 0;
                    currentPortfolioPrevCloses[item.key] = 0;
                }
                updatePortfolioTotals();
                await sleep(400); // Stagger requests
            }
        }
    } finally {
        isBackgroundFetching = false;
        updatePortfolioTotals();
    }
}

function updatePortfolioTotals(forceSort = false) {
    let totalKrw = 0;
    let totalPrevCloseKrw = 0;
    let allLoaded = true;
    
    for (const item of portfolio) {
        const price = currentPortfolioPrices[item.key] || 0;
        let prevClose = currentPortfolioPrevCloses[item.key] || (indices[item.key] ? indices[item.key].previousClose : 0) || price || 0;
        if (price === 0) allLoaded = false;
        
        let isKrw = item.ticker.endsWith('.KS') || item.ticker.endsWith('.KQ') || item.ticker === '^KS11' || item.ticker === '^KQ11';
        
        const itemTotal = price * item.quantity;
        const itemTotalKrw = isKrw ? itemTotal : itemTotal * exchangeRate;
        totalKrw += itemTotalKrw;
        
        if (price > 0 && prevClose > 0) {
            const itemPrevTotal = prevClose * item.quantity;
            const itemPrevTotalKrw = isKrw ? itemPrevTotal : itemPrevTotal * exchangeRate;
            totalPrevCloseKrw += itemPrevTotalKrw;
        }
        
        // Calculate change percent and arrow for rendering
        let changeVal = price - prevClose;
        let changePct = prevClose > 0 ? (changeVal / prevClose) * 100 : 0;
        let arrow = changeVal > 0 ? '▲' : (changeVal < 0 ? '▼' : '');
        let colorClass = changeVal > 0 ? 'positive' : (changeVal < 0 ? 'negative' : '');
        
        const priceDiv = document.getElementById(`pt-price-${item.key}`);
        if (priceDiv) {
            priceDiv.textContent = formatItemPrice(price, isKrw);
        }
        
        const changeDiv = document.getElementById(`pt-change-${item.key}`);
        if (changeDiv) {
            changeDiv.className = `pt-item-price-change ${colorClass}`;
            changeDiv.innerHTML = `${arrow} ${Math.abs(changePct).toFixed(2)}%`;
        }
        
        const valDiv = document.getElementById(`pt-val-${item.key}`);
        if (valDiv) {
            valDiv.className = `pt-val ${colorClass}`;
            valDiv.textContent = price === 0 ? 'Loading...' : `${new Intl.NumberFormat('ko-KR').format(Math.round(itemTotalKrw))}원`;
        }

        // Update data-val-krw attribute on the portfolio item container
        const itemDiv = document.querySelector(`.portfolio-item[data-key="${item.key}"]`);
        if (itemDiv) {
            itemDiv.setAttribute('data-val-krw', itemTotalKrw);
        }
    }

    // Sort DOM elements in-place by valuation descending, but skip it if the user is currently editing a quantity input
    const list = document.getElementById('portfolio-list');
    const shouldSort = forceSort || !activePortfolioItemKey;
    
    if (list && shouldSort) {
        const items = Array.from(list.children);
        items.sort((a, b) => {
            const valA = parseFloat(a.getAttribute('data-val-krw')) || 0;
            const valB = parseFloat(b.getAttribute('data-val-krw')) || 0;
            return valB - valA;
        });
        items.forEach(item => list.appendChild(item));
    }
    
    document.getElementById('portfolio-total-krw').textContent = (!allLoaded && portfolio.length > 0) ? 'Loading...' : new Intl.NumberFormat('ko-KR').format(Math.round(totalKrw));
    
    // Update Total Change
    const totalChangeEl = document.getElementById('portfolio-total-change');
    if (totalChangeEl) {
        if (!allLoaded && portfolio.length > 0) {
            totalChangeEl.textContent = 'Loading...';
        } else if (portfolio.length === 0 || totalPrevCloseKrw === 0) {
            totalChangeEl.textContent = '--';
            totalChangeEl.className = 'change-value';
        } else {
            const totalChangeKrw = totalKrw - totalPrevCloseKrw;
            const totalChangePct = (totalChangeKrw / totalPrevCloseKrw) * 100;
            const absChange = Math.abs(totalChangeKrw);
            const arrow = totalChangeKrw >= 0 ? '▲' : '▼';
            const colorClass = totalChangeKrw >= 0 ? 'positive' : 'negative';
            
            totalChangeEl.className = `change-value ${colorClass}`;
            totalChangeEl.innerHTML = `${arrow} ${new Intl.NumberFormat('ko-KR').format(Math.round(absChange))} (${totalChangePct.toFixed(2)}%)`;
        }
    }
    
    // Update Asset Count
    const activeAssetCount = portfolio.filter(p => p.quantity > 0).length;
    document.getElementById('portfolio-asset-count').textContent = `${activeAssetCount} 개 종목`;
    
    // Update Max Allocation Asset
    const maxAssetEl = document.getElementById('portfolio-max-asset');
    if (maxAssetEl) {
        let maxAsset = null;
        let maxVal = -1;
        for (const item of portfolio) {
            if (item.quantity <= 0) continue;
            const price = currentPortfolioPrices[item.key] || 0;
            const isKrw = item.ticker.endsWith('.KS') || item.ticker.endsWith('.KQ') || item.ticker === '^KS11' || item.ticker === '^KQ11';
            const itemValKrw = (isKrw ? price : price * exchangeRate) * item.quantity;
            if (itemValKrw > maxVal) {
                maxVal = itemValKrw;
                maxAsset = item;
            }
        }
        if (maxAsset && totalKrw > 0) {
            const pct = (maxVal / totalKrw) * 100;
            const rawName = indices[maxAsset.key] ? indices[maxAsset.key].companyName || maxAsset.companyName || maxAsset.name : maxAsset.name;
            const displayCompanyName = getKoreanName(maxAsset.ticker, rawName);
            maxAssetEl.textContent = `${displayCompanyName} (${pct.toFixed(1)}%)`;
        } else {
            maxAssetEl.textContent = '--';
        }
    }
    
    // Update Donut Chart
    updateDonutChart();

    // Update Advisor Widget
    updatePortfolioAdvisor();
}

// ── 한국형 밸류업 & 고배당 스코어링 데이터 ──
const VALUEUP_DATA = {
    "005930.KS": { pbr: 1.25, roe: 9.5, divYield: 2.1 }, // 삼성전자
    "000660.KS": { pbr: 1.85, roe: 14.2, divYield: 1.2 }, // SK하이닉스
    "005380.KS": { pbr: 0.65, roe: 11.5, divYield: 4.8 }, // 현대차
    "000270.KS": { pbr: 0.72, roe: 15.4, divYield: 5.2 }, // 기아
    "105560.KS": { pbr: 0.45, roe: 9.2, divYield: 6.0 },  // KB금융
    "055550.KS": { pbr: 0.42, roe: 8.8, divYield: 5.8 },  // 신한지주
    "035420.KS": { pbr: 1.45, roe: 15.0, divYield: 0.8 }, // NAVER
    "017670.KS": { pbr: 0.85, roe: 10.1, divYield: 6.5 }, // SK텔레콤
    "033780.KS": { pbr: 1.10, roe: 12.3, divYield: 5.9 }, // KT&G
    "138040.KS": { pbr: 0.95, roe: 16.5, divYield: 4.2 }, // 메리츠금융지주
    "012330.KS": { pbr: 0.55, roe: 8.5, divYield: 3.5 },  // 현대모비스
    "086790.KS": { pbr: 0.38, roe: 8.5, divYield: 6.2 },  // 하나금융지주
    "316140.KS": { pbr: 0.35, roe: 8.0, divYield: 6.8 },  // 우리금융지주
    "032640.KS": { pbr: 0.52, roe: 7.2, divYield: 6.4 },  // LG유플러스
    "030200.KS": { pbr: 0.60, roe: 8.9, divYield: 5.5 }   // KT
};

function updatePortfolioAdvisor() {
    // Removed as per user request
    return;
}

function setActiveStock(key) {
    if (activePortfolioItemKey !== key) {
        const oldKey = activePortfolioItemKey;
        activePortfolioItemKey = key;
        if (oldKey) {
            setTimeout(() => {
                updatePortfolioTotals(true);
            }, 0);
        }
    }
}

document.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.portfolio-item');
    const key = item ? item.getAttribute('data-key') : null;
    setActiveStock(key);
});

document.addEventListener('focusin', (e) => {
    if (e.target === document.body || e.target === document.documentElement) {
        return;
    }
    const item = e.target.closest('.portfolio-item');
    const key = item ? item.getAttribute('data-key') : null;
    setActiveStock(key);
});

function updateDonutChart() {
    const canvas = document.getElementById('portfolio-donut-chart');
    if (!canvas) return;
    const donutCtx = canvas.getContext('2d');
    if (!donutCtx) return;
    
    const activeItems = portfolio.filter(p => p.quantity > 0);
    
    let totalKrw = 0;
    const values = [];
    
    for (const item of activeItems) {
        const price = currentPortfolioPrices[item.key] || 0;
        let isKrw = item.ticker.endsWith('.KS') || item.ticker.endsWith('.KQ') || item.ticker === '^KS11' || item.ticker === '^KQ11';
        const itemTotal = price * item.quantity;
        const itemTotalKrw = isKrw ? itemTotal : itemTotal * exchangeRate;
        totalKrw += itemTotalKrw;
        const rawName = indices[item.key] ? indices[item.key].companyName || item.companyName || item.name : item.name;
        values.push({
            name: getKoreanName(item.ticker, rawName),
            valKrw: itemTotalKrw
        });
    }
    
    if (activeItems.length === 0 || totalKrw === 0) {
        if (portfolioDonutChart) {
            portfolioDonutChart.destroy();
            portfolioDonutChart = null;
        }
        portfolioDonutChart = new Chart(donutCtx, {
            type: 'doughnut',
            data: {
                labels: ['보유 자산 없음'],
                datasets: [{
                    data: [100],
                    backgroundColor: ['rgba(255, 255, 255, 0.05)'],
                    borderColor: ['rgba(255, 255, 255, 0.1)'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }
    
    values.sort((a, b) => b.valKrw - a.valKrw);
    
    const chartData = values.map(v => v.valKrw);
    const chartLabels = values.map(v => v.name);
    
    const colors = [
        '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
        '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6',
        '#a855f7', '#6366f1', '#84cc16'
    ];
    
    if (portfolioDonutChart) {
        portfolioDonutChart.destroy();
    }
    
    portfolioDonutChart = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
            labels: chartLabels,
            datasets: [{
                data: chartData,
                backgroundColor: colors.slice(0, chartData.length).map(c => c + 'dd'),
                borderColor: '#0b0f19',
                borderWidth: 2,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            const pct = ((val / totalKrw) * 100).toFixed(1);
                            return ` ${context.label}: ${new Intl.NumberFormat('ko-KR').format(Math.round(val))}원 (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

let backtestChartInstance = null;
let currentBTRange = '5y';
let fullBacktestData = [];

function setBacktestProgress(step, total, statusText, detailText) {
    const pct = total > 0 ? Math.round((step / total) * 100) : 0;
    const bar = document.getElementById('backtest-progress-bar');
    const status = document.getElementById('backtest-loading-status');
    const detail = document.getElementById('backtest-loading-detail');
    if (bar) bar.style.width = pct + '%';
    if (status) status.textContent = statusText;
    if (detail) detail.textContent = detailText || '';
}

// BUG 3 FIX: Historical USD/KRW annual average rates as fallback
// Source: Bank of Korea annual average data
const HISTORICAL_KRW_FALLBACK = {
    2015: 1131, 2016: 1160, 2017: 1130, 2018: 1100,
    2019: 1166, 2020: 1180, 2021: 1144, 2022: 1292,
    2023: 1305, 2024: 1363, 2025: 1420
};

function getHistoricalKrw(timestamp) {
    const year = new Date(timestamp).getFullYear();
    // Find closest year in our table
    const years = Object.keys(HISTORICAL_KRW_FALLBACK).map(Number).sort((a,b) => a-b);
    const clampedYear = Math.max(years[0], Math.min(years[years.length - 1], year));
    return HISTORICAL_KRW_FALLBACK[clampedYear] || 1300;
}

// BUG 1 FIX: Use 'YYYY-MM-DD' string keys to avoid KST/UTC timezone mismatch
function toDateKey(timestamp) {
    // Yahoo Finance timestamps are UTC seconds; we normalize using UTC date string
    const d = new Date(timestamp);
    const yyyy = d.getUTCFullYear();
    const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd   = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

async function runBacktest() {
    const loadingEl = document.getElementById('backtest-loading');
    loadingEl.style.display = 'flex';
    setBacktestProgress(0, 100, 'Loading Exchange Rate...', 'Fetching USD/KRW data');

    try {
        // BUG 1 FIX: fetch10y returns { dateKey, p } using UTC-based date string
        const fetch10y = async (ticker) => {
            const cacheBuster = `&_=${new Date().getTime()}`;
            const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=10y${cacheBuster}`;
            const data = await fetchWithFallback(yahooUrl, 5000);
            if (!data || !data.chart || !data.chart.result) return [];
            const result = data.chart.result[0];
            const timestamps = result.timestamp;
            const prices = result.indicators?.quote?.[0]?.close;
            let clean = [];
            if (timestamps && prices) {
                for (let j = 0; j < timestamps.length; j++) {
                    if (prices[j] !== null && prices[j] !== undefined) {
                        clean.push({
                            dateKey: toDateKey(timestamps[j] * 1000),
                            t: timestamps[j] * 1000,
                            p: prices[j]
                        });
                    }
                }
            }
            return clean;
        };

        // BUG 4 FIX: Skip items with quantity === 0 to avoid unnecessary API calls
        const activePortfolio = portfolio.filter(item => item.quantity > 0);

        // Total steps: 1 (exchange rate) + activePortfolio.length + 1 (processing)
        const totalSteps = 1 + activePortfolio.length + 1;

        // Step 1: Exchange Rate
        const krwData = await fetch10y('KRW=X');
        const krwApiOk = krwData.length > 0;
        setBacktestProgress(1, totalSteps, 'Loading Stock Data...',
            `Exchange rate loaded (${krwApiOk ? 'OK' : '⚠ API failed, using historical fallback'})`);

        // Steps 2..N: Each active portfolio item
        const ptData = [];
        for (let index = 0; index < activePortfolio.length; index++) {
            const item = activePortfolio[index];
            setBacktestProgress(
                1 + index,
                totalSteps,
                `Loading ${item.ticker}...`,
                `${index + 1} / ${activePortfolio.length} stocks fetched`
            );
            const data = await fetch10y(item.ticker);
            const isKrw = item.ticker.endsWith('.KS') || item.ticker.endsWith('.KQ')
                       || item.ticker === '^KS11' || item.ticker === '^KQ11';
            ptData.push({ item, isKrw, data });
            await sleep(500);
        }

        // Final step: Processing
        setBacktestProgress(totalSteps - 1, totalSteps, 'Processing Simulation...', 'Calculating portfolio value over time');
        await sleep(50); // Let UI repaint before heavy computation

        // BUG 1 FIX: Build maps keyed by 'YYYY-MM-DD' string for reliable lookup
        const buildSeriesByKey = (dataArray) => {
            const map = {};
            dataArray.forEach(d => { map[d.dateKey] = d.p; });
            return map;
        };

        const krwByKey = buildSeriesByKey(krwData);

        const ptSeries = ptData.map(p => ({
            ...p,
            mapByKey: buildSeriesByKey(p.data),
            // firstDateKey: the earliest dateKey with data
            firstDateKey: p.data.length > 0 ? p.data[0].dateKey : null,
            firstT:       p.data.length > 0 ? p.data[0].t : Infinity
        }));

        // Collect all unique (timestamp, dateKey) pairs, sorted by time
        const allEntries = new Map(); // dateKey → earliest t for that key
        krwData.forEach(d => {
            if (!allEntries.has(d.dateKey)) allEntries.set(d.dateKey, d.t);
        });
        ptData.forEach(p => p.data.forEach(d => {
            if (!allEntries.has(d.dateKey)) allEntries.set(d.dateKey, d.t);
        }));
        const sortedEntries = Array.from(allEntries.entries())
            .sort((a, b) => a[1] - b[1]); // sort by timestamp

        // BUG 2 FIX: Initialize lastPrices with first known price for each stock
        const lastPrices = ptSeries.map(p =>
            p.data.length > 0 ? p.data[0].p : 0
        );

        // BUG 3 FIX: Start lastKrw from historical table if API failed
        let lastKrw = krwApiOk
            ? (krwData[0]?.p || getHistoricalKrw(krwData[0]?.t || Date.now()))
            : getHistoricalKrw(sortedEntries[0]?.[1] || Date.now());

        fullBacktestData = [];

        for (const [dateKey, t] of sortedEntries) {
            // BUG 1 FIX: Match by dateKey string → no timezone mismatch
            if (krwByKey[dateKey] !== undefined) {
                lastKrw = krwByKey[dateKey];
            } else if (!krwApiOk) {
                // BUG 3 FIX: Use year-specific historical rate when API data is absent
                lastKrw = getHistoricalKrw(t);
            }
            // (if krwApi was OK but this day has no exchange data, carry-forward lastKrw — correct behavior)

            let dailyTotalKrw = 0;
            for (let i = 0; i < ptSeries.length; i++) {
                const p = ptSeries[i];
                if (p.firstDateKey === null || dateKey < p.firstDateKey) continue; // before this stock's data

                // BUG 1 FIX: Look up price by dateKey, not numeric timestamp
                if (p.mapByKey[dateKey] !== undefined) {
                    lastPrices[i] = p.mapByKey[dateKey];
                }
                // BUG 2 FIX: lastPrices[i] is already initialized to first price, never 0 for active stocks
                const val = lastPrices[i] * p.item.quantity;
                dailyTotalKrw += p.isKrw ? val : val * lastKrw;
            }

            fullBacktestData.push({ t, v: dailyTotalKrw });
        }

        setBacktestProgress(totalSteps, totalSteps, 'Analysis Complete!', '');
        await sleep(300); // Brief "complete" flash

        updateBacktestChartRange();

    } catch(e) {
        console.error(e);
        alert('Failed to load backtest data. Rate limit may have been reached.');
    } finally {
        document.getElementById('backtest-loading').style.display = 'none';
    }
}

function updateBacktestChartRange() {
    if (!fullBacktestData || fullBacktestData.length === 0) return;

    const emptyEl  = document.getElementById('backtest-empty');
    const canvasEl = document.getElementById('backtest-chart');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (canvasEl) canvasEl.style.display = 'block';

    const now = new Date().getTime();
    let cutoff = 0;

    switch (currentBTRange) {
        case '10y': cutoff = now - 10 * 365 * 24 * 60 * 60 * 1000; break;
        case '7y':  cutoff = now -  7 * 365 * 24 * 60 * 60 * 1000; break;
        case '5y':  cutoff = now -  5 * 365 * 24 * 60 * 60 * 1000; break;
        case '3y':  cutoff = now -  3 * 365 * 24 * 60 * 60 * 1000; break;
        case '1y':  cutoff = now -      365 * 24 * 60 * 60 * 1000; break;
        case '6mo': cutoff = now -  180 * 24 * 60 * 60 * 1000; break;
    }
    
    const filtered = fullBacktestData.filter(d => d.t >= cutoff);
    const btCanvas = document.getElementById('backtest-chart');
    if (!btCanvas) return;
    const ctx = btCanvas.getContext('2d');
    if (!ctx) return;
    
    if (backtestChartInstance) {
        backtestChartInstance.destroy();
    }
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    backtestChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Portfolio Value (KRW)',
                data: filtered.map(d => ({ x: d.t, y: d.v })),
                borderColor: '#8b5cf6',
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                pointRadius: 0,
                pointHitRadius: 10,
                pointHoverRadius: 4
            }]
        },
        options: {
            ...commonChartOptions,
            plugins: {
                ...commonChartOptions.plugins,
                tooltip: {
                    ...commonChartOptions.plugins.tooltip,
                    callbacks: {
                        title: function(context) {
                             const rawTime = context[0].raw?.x;
                             if (rawTime) {
                                 return new Date(rawTime).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                             }
                             return '';
                         },
                         label: function(context) {
                             const currentVal = context.raw?.y;
                             if (currentVal === undefined) return '';

                             const dataset = context.dataset;
                             const dataPoints = dataset.data;
                             if (!dataPoints || dataPoints.length === 0) return '';
                             
                             const firstPoint = dataPoints[0];
                             const startVal = firstPoint?.y;
                             
                             let pctHtml = '';
                             if (startVal !== undefined && startVal !== null && startVal !== 0) {
                                 const pctChange = ((currentVal - startVal) / startVal) * 100;
                                 const sign = pctChange >= 0 ? '+' : '';
                                 pctHtml = ` (${sign}${pctChange.toFixed(2)}%)`;
                             }
                             return new Intl.NumberFormat('ko-KR').format(Math.round(currentVal)) + ' KRW' + pctHtml;
                         }
                    }
                }
            },
            scales: {
                ...commonChartOptions.scales,
                x: {
                    ...commonChartOptions.scales.x,
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: 8,
                        maxRotation: 0,
                        autoSkip: true,
                        font: { family: "'Inter', sans-serif", size: 12 },
                        callback: function(value, index, ticks) {
                            return new Date(ticks[index].value).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
                        }
                    }
                },
                y: {
                    ...commonChartOptions.scales.y,
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 12 },
                        callback: function(value) {
                            return new Intl.NumberFormat('ko-KR', { notation: "compact", compactDisplay: "short" }).format(value);
                        }
                    }
                }
            }
        }
    });
}

// Run on load
document.addEventListener('DOMContentLoaded', async () => {
    // Load local full stock database early
    if (!cachedKoreanStocks) {
        fetch('korean_stocks.json')
            .then(res => {
                if (res.ok) return res.json();
                throw new Error("Failed to load");
            })
            .then(data => {
                cachedKoreanStocks = data;
            })
            .catch(err => {
                console.error("Failed to load korean_stocks.json early:", err);
            });
    }

    // ── Router check ──────────────────────────────────────────
    const path = window.location.pathname;
    if (path.endsWith('/privacy')) {
        document.body.innerHTML = '<iframe src="privacy.pdf" style="width:100%; height:100vh; border:none; margin:0; padding:0; overflow:hidden; z-index:999999; position:fixed; top:0; left:0; right:0; bottom:0;"></iframe>';
        document.title = "개인정보처리방침 | StockPulse";
        return;
    } else if (path.endsWith('/service')) {
        document.body.innerHTML = '<iframe src="service.pdf" style="width:100%; height:100vh; border:none; margin:0; padding:0; overflow:hidden; z-index:999999; position:fixed; top:0; left:0; right:0; bottom:0;"></iframe>';
        document.title = "서비스이용약관 | StockPulse";
        return;
    }

    // ── Footer Links Routing ──────────────────────────────────
    const privacyLink = document.getElementById('privacy-link');
    const serviceLink = document.getElementById('service-link');
    if (privacyLink) {
        privacyLink.addEventListener('click', (e) => {
            e.preventDefault();
            history.pushState(null, '', '/privacy');
            document.body.innerHTML = '<iframe src="privacy.pdf" style="width:100%; height:100vh; border:none; margin:0; padding:0; overflow:hidden; z-index:999999; position:fixed; top:0; left:0; right:0; bottom:0;"></iframe>';
            document.title = "개인정보처리방침 | StockPulse";
        });
    }
    if (serviceLink) {
        serviceLink.addEventListener('click', (e) => {
            e.preventDefault();
            history.pushState(null, '', '/service');
            document.body.innerHTML = '<iframe src="service.pdf" style="width:100%; height:100vh; border:none; margin:0; padding:0; overflow:hidden; z-index:999999; position:fixed; top:0; left:0; right:0; bottom:0;"></iframe>';
            document.title = "서비스이용약관 | StockPulse";
        });
    }
    window.addEventListener('popstate', () => {
        window.location.reload();
    });

    // ── Global Custom Tooltip setup ───────────────────────────
    const globalTooltip = document.createElement('div');
    globalTooltip.className = 'custom-tooltip';
    globalTooltip.style.cssText = `
        position: absolute;
        background: rgba(11, 15, 25, 0.95);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #f1f5f9;
        padding: 0.6rem 0.8rem;
        border-radius: 8px;
        font-size: 0.75rem;
        font-weight: 500;
        line-height: 1.4;
        max-width: 280px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
        transform: translateY(4px);
        z-index: 99999;
    `;
    document.body.appendChild(globalTooltip);

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;

        const text = target.getAttribute('data-tooltip');
        if (!text) return;

        globalTooltip.textContent = text;
        globalTooltip.style.opacity = '1';
        globalTooltip.style.transform = 'translateY(0)';

        // Position the tooltip
        const rect = target.getBoundingClientRect();
        
        // Temporarily display to get actual height/width
        globalTooltip.style.display = 'block';
        const tooltipRect = globalTooltip.getBoundingClientRect();

        let top = rect.top + window.scrollY - tooltipRect.height - 8;
        let left = rect.left + window.scrollX + (rect.width - tooltipRect.width) / 2;

        if (top < window.scrollY) {
            top = rect.bottom + window.scrollY + 8;
        }
        if (left < 0) {
            left = 8;
        } else if (left + tooltipRect.width > window.innerWidth) {
            left = window.innerWidth - tooltipRect.width - 8;
        }

        globalTooltip.style.top = `${top}px`;
        globalTooltip.style.left = `${left}px`;
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;
        globalTooltip.style.opacity = '0';
        globalTooltip.style.transform = 'translateY(4px)';
    });

    // ── Tab Switching ──────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');

            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`tab-${tab}`).classList.add('active');

            // Show/hide the stocks toolbar
            const toolbar = document.getElementById('stocks-toolbar');
            if (toolbar) toolbar.style.display = (tab === 'stocks') ? '' : 'none';

            // When entering portfolio tab, render portfolio list
            if (tab === 'portfolio') renderPortfolio();
            // When entering recommend tab, init recommended portfolios
            if (tab === 'recommend') initRecommendedTab();
            // When entering expert tab, init expert tab
            if (tab === 'expert') initExpertTab();
        });
    });

    // ── Analyze Portfolio Button ───────────────────────────────
    document.getElementById('analyze-portfolio-btn').addEventListener('click', async () => {
        const activeItems = portfolio.filter(p => p.quantity > 0);
        if (activeItems.length === 0) {
            alert('포트폴리오에 수량이 있는 종목을 추가해 주세요.');
            return;
        }
        const backtestModal = document.getElementById('backtest-modal');
        if (backtestModal) backtestModal.classList.add('active');
        await runBacktest();
    });

    // ── Backtest Range Buttons ─────────────────────────────────
    document.querySelectorAll('.bt-range-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.bt-range-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentBTRange = e.target.getAttribute('data-range');
            if (backtestChartInstance) updateBacktestChartRange();
        });
    });

    // ── Chart Modal ────────────────────────────────────────────
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('chart-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('chart-modal')) closeModal();
    });

    // ── Expert Detail Modal Close ──────────────────────────────
    const expertCloseBtn = document.getElementById('expert-detail-modal-close-btn');
    const expertModal = document.getElementById('expert-detail-modal');
    if (expertCloseBtn && expertModal) {
        expertCloseBtn.addEventListener('click', () => {
            expertModal.classList.remove('active');
            if (expertDetailChartInstance) {
                expertDetailChartInstance.destroy();
                expertDetailChartInstance = null;
            }
        });
        expertModal.addEventListener('click', (e) => {
            if (e.target === expertModal) {
                expertModal.classList.remove('active');
                if (expertDetailChartInstance) {
                    expertDetailChartInstance.destroy();
                    expertDetailChartInstance = null;
                }
            }
        });
    }

    // ── Range Buttons (Expert Picks Modal Chart) ──────────────
    const expertRangeBtns = document.querySelectorAll('.range-btn-expert');
    expertRangeBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            expertRangeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            expertDetailChartRange = e.target.getAttribute('data-range');
            if (expertDetailTicker) {
                initExpertDetailChart(expertDetailTicker);
            }
        });
    });

    // ── Expert Guide Modal Close ───────────────────────────────
    const expertGuideCloseBtn = document.getElementById('expert-guide-modal-close-btn');
    const expertGuideModal = document.getElementById('expert-guide-modal');
    if (expertGuideCloseBtn && expertGuideModal) {
        expertGuideCloseBtn.addEventListener('click', () => expertGuideModal.classList.remove('active'));
        expertGuideModal.addEventListener('click', (e) => {
            if (e.target === expertGuideModal) expertGuideModal.classList.remove('active');
        });
    }

    // ── Backtest Modal Close ──────────────────────────────────
    const backtestCloseBtn = document.getElementById('backtest-modal-close-btn');
    const backtestModal = document.getElementById('backtest-modal');
    if (backtestCloseBtn && backtestModal) {
        backtestCloseBtn.addEventListener('click', () => backtestModal.classList.remove('active'));
        backtestModal.addEventListener('click', (e) => {
            if (e.target === backtestModal) backtestModal.classList.remove('active');
        });
    }

    // ── Range / Type Buttons (Stocks tab) ─────────────────────
    const rangeBtns = document.querySelectorAll('.range-btn');
    rangeBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            rangeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentRangeKey = e.target.getAttribute('data-range');

            for (const key of Object.keys(indices)) {
                if (document.getElementById(`${indices[key].elementId}-price`)) {
                    document.getElementById(`${indices[key].elementId}-price`).textContent = 'Loading...';
                }
                initSingleChart(key).then(() => {
                    if (currentModalKey === key && modalChartInstance) openModal(key);
                });
                await sleep(400);
            }
        });
    });

    const typeBtns = document.querySelectorAll('.type-btn');
    typeBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            typeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentChartType = e.target.getAttribute('data-type');

            for (const key of Object.keys(indices)) {
                if (document.getElementById(`${indices[key].elementId}-price`)) {
                    document.getElementById(`${indices[key].elementId}-price`).textContent = 'Loading...';
                }
                initSingleChart(key).then(() => {
                    if (currentModalKey === key && modalChartInstance) openModal(key);
                });
                await sleep(100);
            }
        });
    });

    // ── Add Chart ─────────────────────────────────────────────
    document.getElementById('add-chart-btn').addEventListener('click', handleAddChart);
    document.getElementById('ticker-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAddChart();
    });

    setupCardClickListeners();
    setupLogin();
    setupReportModalListeners();
    setupDragAndDropListeners();
    setupSearchCodeModalListeners();
    setupRecommendModalListeners();
    await initCharts();
    startRealtimeUpdates();
    initPortfolioSnapshots();
});

// =====================================================
// Recommended Portfolio Feature
// =====================================================

const ALLOC_COLORS = [
    '#3b82f6','#8b5cf6','#ec4899','#10b981',
    '#f59e0b','#06b6d4','#a855f7','#ef4444'
];

const RECOMMENDED_PORTFOLIOS = [
    {
        id: 'core_satellite',
        name: '핵심-위성 (Core-Satellite) 포트폴리오',
        description: '대표 지수 ETF로 뼈대를 든든하게 세우고, 트렌디한 테마 ETF로 알파(초과 수익)를 추구합니다.',
        category: '핵심-위성', categoryColor: '#3b82f6',
        allocations: [
            { ticker: '360750.KS', label: 'TIGER 미국S&P500 (핵심 70%)', ratio: 0.70 },
            { ticker: '395160.KS', label: 'KODEX AI반도체TOP2플러스 (위성 30%)', ratio: 0.30 }
        ]
    },
    {
        id: 'all_weather_var',
        name: '올웨더 (All-Weather) 변형 포트폴리오',
        description: '주식, 장기채권, 금현물, 현금성 자산을 분산 배치하여 시장 변동기 하락 위험을 상쇄합니다.',
        category: '자산배분', categoryColor: '#10b981',
        allocations: [
            { ticker: '360750.KS', label: 'TIGER 미국S&P500 (주식 35%)', ratio: 0.35 },
            { ticker: '458250.KS', label: 'TIGER 미국30년국채커버드콜 (장기채 45%)', ratio: 0.45 },
            { ticker: '368590.KS', label: 'TIGER KRX금현물 (금 15%)', ratio: 0.15 },
            { ticker: '459580.KS', label: 'KODEX CD금리액티브(합성) (현금성 5%)', ratio: 0.05 }
        ]
    },
    {
        id: 'k_valueup_dividend',
        name: '한국형 기업 밸류업 & 고배당 포트폴리오',
        description: '밸류업 정책 수혜 ETF, 국내 고배당 Core ETF, 대형 지주사 개별주를 조합해 현금흐름을 극대화합니다.',
        category: '밸류업/배당', categoryColor: '#f59e0b',
        allocations: [
            { ticker: '495120.KS', label: 'KODEX 코리아밸류업 (밸류업 40%)', ratio: 0.40 },
            { ticker: '161510.KS', label: 'ARIRANG 고배당주 (고배당 40%)', ratio: 0.40 },
            { ticker: '105560.KS', label: 'KB금융 (대형금융주 20%)', ratio: 0.20 }
        ]
    },
    {
        id: 'sector_momentum',
        name: '주도주 듀얼 모멘텀 (Dual Momentum)',
        description: '기관/외국인 수급이 집중되는 최상위 섹터 ETF에 집중 투자하고, 시장 급락 시 현금성 자산으로 대피합니다.',
        category: '모멘텀', categoryColor: '#ec4899',
        allocations: [
            { ticker: '395160.KS', label: 'KODEX AI반도체TOP2플러스 (섹터1위 40%)', ratio: 0.40 },
            { ticker: '487240.KS', label: 'KODEX AI전력핵심설비 (섹터2위 40%)', ratio: 0.40 },
            { ticker: '459580.KS', label: 'KODEX CD금리액티브(합성) (대피소 20%)', ratio: 0.20 }
        ]
    }
];

const pieChartInstances = {};
const recTickerCache    = {};
const recChartInstances = {};
let   recStatsLoaded    = false;

function initRecommendedTab() {
    renderRecommendedComparison();
    if (!recStatsLoaded) loadRecStats();
}

// Classification helper for recommended strategy comparison
function classifyAssetForStrategy(ticker, name, strategyId) {
    const cleanTicker = ticker.toUpperCase();
    const cleanName = (name || '').toUpperCase();
    const etf = ETF_DATABASE[cleanTicker];
    
    if (strategyId === 'core_satellite') {
        const isCore = (etf && etf.category === 'INDEX') ||
                       ['069500.KS', '360750.KS', '379800.KS', '379810.KS', '133690.KS', '292150.KS', 'SPY', 'QQQ', 'DIA', 'IVV', 'VOO'].includes(cleanTicker) ||
                       cleanName.includes('KOSPI') || cleanName.includes('S&P 500') || cleanName.includes('S&P500') || cleanName.includes('나스닥100') || cleanName.includes('NASDAQ 100');
        return isCore ? 'core' : 'satellite';
    }
    
    if (strategyId === 'all_weather_var') {
        if (cleanTicker === '368590.KS' || cleanName.includes('금현물') || cleanName.includes('GOLD') || cleanName.includes('GLD')) {
            return 'gold';
        }
        if (cleanTicker === '459580.KS' || cleanName.includes('CD금리') || cleanName.includes('KOFR') || cleanName.includes('CASH') || cleanName.includes('머니마켓') || cleanName.includes('단기사채')) {
            return 'cash';
        }
        if (cleanTicker === '458250.KS' || cleanName.includes('채권') || cleanName.includes('국채') || cleanName.includes('BOND') || cleanName.includes('TREASURY')) {
            return 'bond';
        }
        return 'equity';
    }
    
    if (strategyId === 'k_valueup_dividend') {
        if (cleanTicker === '495120.KS' || cleanName.includes('밸류업') || cleanName.includes('VALUE-UP') || cleanName.includes('지배구조')) {
            return 'valueup';
        }
        if (cleanTicker === '161510.KS' || cleanName.includes('고배당') || cleanName.includes('DIVIDEND') || cleanName.includes('배당성장') || cleanName.includes('배당주') || (etf && etf.category === 'INCOME' && cleanTicker !== '459580.KS' && cleanTicker !== '458250.KS')) {
            return 'dividend';
        }
        const financials = ['105560.KS', '055550.KS', '086790.KS', '316140.KS', '138040.KS', '005380.KS', '000270.KS'];
        if (financials.includes(cleanTicker) || cleanName.includes('금융지주') || cleanName.includes('은행') || cleanName.includes('증권') || cleanName.includes('카드') || cleanName.includes('보험')) {
            return 'financial';
        }
        return 'other';
    }
    
    if (strategyId === 'sector_momentum') {
        if (cleanTicker === '395160.KS' || cleanName.includes('반도체') || cleanName.includes('SEMICONDUCTOR')) {
            return 'sector1';
        }
        if (cleanTicker === '487240.KS' || cleanName.includes('전력') || cleanName.includes('송배전') || cleanName.includes('인프라') || cleanName.includes('에너지')) {
            return 'sector2';
        }
        if (cleanTicker === '459580.KS' || cleanName.includes('CD금리') || cleanName.includes('KOFR') || cleanName.includes('CASH') || cleanName.includes('채권') || cleanName.includes('BOND')) {
            return 'cash';
        }
        return 'other';
    }
    
    return 'other';
}

const STRATEGY_CATEGORIES = {
    core_satellite: [
        { key: 'core', label: '핵심 자산 (지수형 ETF)', ratio: 0.70 },
        { key: 'satellite', label: '위성 자산 (개별주/테마)', ratio: 0.30 }
    ],
    all_weather_var: [
        { key: 'equity', label: '국내외 주식 지수 ETF', ratio: 0.35 },
        { key: 'bond', label: '국내/미국 장기채권 ETF', ratio: 0.45 },
        { key: 'gold', label: '금(Gold) 현물 ETF', ratio: 0.15 },
        { key: 'cash', label: '현금성 자산', ratio: 0.05 }
    ],
    k_valueup_dividend: [
        { key: 'valueup', label: '밸류업/지배구조 ETF', ratio: 0.40 },
        { key: 'dividend', label: '국내 고배당 Core ETF', ratio: 0.40 },
        { key: 'financial', label: '금융/지주사 개별 우량주', ratio: 0.20 }
    ],
    sector_momentum: [
        { key: 'sector1', label: '모멘텀 1위 섹터 ETF', ratio: 0.40 },
        { key: 'sector2', label: '모멘텀 2위 섹터 ETF', ratio: 0.40 },
        { key: 'cash', label: '현금성/단기채 ETF', ratio: 0.20 }
    ]
};

const recChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { display: false },
        tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(22, 30, 46, 0.9)',
            titleColor: '#f8fafc',
            bodyColor: '#f8fafc',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 10,
            displayColors: false,
            callbacks: {
                title: function(context) {
                    if (!context || !context.length) return '';
                    const rawTime = context[0].raw?.x;
                    if (rawTime) {
                        const d = new Date(rawTime);
                        return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
                    }
                    return context[0].label;
                },
                label: function(context) {
                    const val = context.raw?.y;
                    if (val === undefined) return '';
                    const formattedVal = new Intl.NumberFormat('ko-KR').format(Math.round(val));
                    const chartData = context.dataset.data;
                    const startVal = chartData[0]?.y || 10000000;
                    const pctChange = ((val - startVal) / startVal) * 100;
                    const sign = pctChange >= 0 ? '+' : '';
                    return `평가자산: ${formattedVal}원 (${sign}${pctChange.toFixed(2)}%)`;
                }
            }
        }
    },
    scales: {
        x: {
            type: 'timeseries',
            display: true,
            grid: {
                color: 'rgba(255, 255, 255, 0.05)',
                drawBorder: false,
            },
            ticks: {
                color: '#94a3b8',
                maxTicksLimit: 6,
                maxRotation: 0,
                autoSkip: true,
                font: {
                    family: "'Inter', sans-serif",
                    size: 10
                }
            }
        },
        y: {
            display: true,
            position: 'right',
            grid: {
                color: 'rgba(255, 255, 255, 0.05)',
                drawBorder: false,
            },
            ticks: {
                color: '#94a3b8',
                font: {
                    family: "'Inter', sans-serif",
                    size: 11
                },
                callback: function(value) {
                    if (value >= 100000000) {
                        return (value / 100000000).toFixed(1) + '억원';
                    }
                    if (value >= 10000) {
                        return (value / 10000).toFixed(0) + '만원';
                    }
                    return value;
                }
            }
        }
    },
    interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
    },
    elements: {
        point: {
            radius: 0,
            hitRadius: 10,
            hoverRadius: 4
        },
        line: {
            tension: 0.2
        }
    }
};

function getRecPortfolioHistory(pf, rangeKey) {
    if (!pf.allocations.every(a => recTickerCache[a.ticker] && recTickerCache[a.ticker].length > 0)) return null;

    const earliestT = Math.max.apply(null, pf.allocations.map(a => recTickerCache[a.ticker][0].t));
    const endT      = Math.min.apply(null, pf.allocations.map(a => recTickerCache[a.ticker][recTickerCache[a.ticker].length-1].t));
    if (earliestT >= endT) return null;

    let startT = earliestT;
    const msInYear = 365.25 * 24 * 60 * 60 * 1000;
    if (rangeKey === '1y') {
        startT = Math.max(earliestT, endT - 1 * msInYear);
    } else if (rangeKey === '3y') {
        startT = Math.max(earliestT, endT - 3 * msInYear);
    } else if (rangeKey === '5y') {
        startT = Math.max(earliestT, endT - 5 * msInYear);
    } else if (rangeKey === '10y') {
        startT = Math.max(earliestT, endT - 10 * msInYear);
    }

    const maps = pf.allocations.map(a => {
        const m = {};
        recTickerCache[a.ticker].forEach(d => { m[d.t] = d.p; });
        return m;
    });

    const initPrices = pf.allocations.map((a) => {
        const first = recTickerCache[a.ticker].find(d => d.t >= startT);
        return first ? first.p : null;
    });
    if (initPrices.some(p => !p)) return null;

    const tsSet = new Set();
    pf.allocations.forEach(a => {
        recTickerCache[a.ticker].forEach(d => { if (d.t >= startT && d.t <= endT) tsSet.add(d.t); });
    });
    const sorted = Array.from(tsSet).sort((a, b) => a - b);
    if (sorted.length < 2) return null;

    const lastP  = initPrices.slice();
    const dataPoints = sorted.map(t => {
        pf.allocations.forEach((a, i) => { if (maps[i][t] != null) lastP[i] = maps[i][t]; });
        const val = pf.allocations.reduce((s, a, i) => s + a.ratio * (lastP[i] / initPrices[i]) * 10000000, 0);
        return { x: t, y: val };
    });

    return dataPoints;
}

window.renderRecPortfolioChart = function(pfId, rangeKey = '5y') {
    const pf = RECOMMENDED_PORTFOLIOS.find(p => p.id === pfId);
    if (!pf) return;

    const canvas = document.getElementById(`rec-chart-${pfId}`);
    if (!canvas) {
        console.warn(`renderRecPortfolioChart: Canvas element for ${pfId} not found.`);
        return;
    }

    const dataPoints = getRecPortfolioHistory(pf, rangeKey);
    if (!dataPoints || dataPoints.length === 0) {
        console.warn(`renderRecPortfolioChart: No data points for ${pfId}.`);
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Highlight the active range button
    const drawer = document.getElementById(`drawer-${pfId}`);
    if (drawer) {
        drawer.querySelectorAll('.rec-range-btn').forEach(btn => {
            if (btn.getAttribute('data-range') === rangeKey) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    if (recChartInstances[pfId]) {
        recChartInstances[pfId].destroy();
    }

    // Determine line color based on performance
    const firstVal = dataPoints[0].y;
    const lastVal = dataPoints[dataPoints.length - 1].y;
    const isPositive = lastVal >= firstVal;
    const lineColor = isPositive ? '#ef4444' : '#3b82f6';
    const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 200);
    bgGradient.addColorStop(0, isPositive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)');
    bgGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    recChartInstances[pfId] = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: pf.name,
                data: dataPoints,
                borderColor: lineColor,
                borderWidth: 2,
                fill: true,
                backgroundColor: bgGradient,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHitRadius: 10
            }]
        },
        options: {
            ...recChartOptions,
            scales: {
                ...recChartOptions.scales,
                x: {
                    ...recChartOptions.scales.x,
                    ticks: {
                        ...recChartOptions.scales.x.ticks,
                        callback: function(value, index, ticks) {
                            const date = new Date(ticks[index].value);
                            const y = String(date.getFullYear()).slice(-2);
                            const m = String(date.getMonth() + 1).padStart(2, '0');
                            return `${y}.${m}`;
                        }
                    }
                }
            }
        }
    });

    // Calculate and update stats for the selected range dynamically
    const stats = calcRecStats(pf, rangeKey);
    const cagrEl = document.getElementById('cagr-' + pfId);
    const mddEl  = document.getElementById('mdd-'  + pfId);
    const volEl  = document.getElementById('vol-'  + pfId);
    const sharpeEl = document.getElementById('sharpe-' + pfId);
    
    if (cagrEl && mddEl && volEl && sharpeEl && stats) {
        const sign = stats.cagr >= 0 ? '+' : '';
        const cls  = stats.cagr >= 0 ? 'positive' : 'negative';
        cagrEl.innerHTML = '<span class="' + cls + '">' + sign + stats.cagr.toFixed(2) + '%</span>';
        mddEl.innerHTML  = '<span class="negative">-' + stats.mdd.toFixed(2) + '%</span>';
        volEl.innerHTML  = '<span style="color: #cbd5e1;">' + stats.volatility.toFixed(2) + '%</span>';
        
        const sharpeColor = stats.sharpe >= 1.0 ? '#10b981' : (stats.sharpe < 0 ? '#ef4444' : '#fbbf24');
        sharpeEl.innerHTML = `<span style="color: ${sharpeColor}; font-weight: 700;">${stats.sharpe.toFixed(2)}</span>`;
    }
};

window.changeRecChartRange = function(pfId, rangeKey) {
    renderRecPortfolioChart(pfId, rangeKey);
};

window.toggleCompDetails = function(pfId) {
    const drawer = document.getElementById(`drawer-${pfId}`);
    const icon = document.getElementById(`toggle-icon-${pfId}`);
    if (drawer) {
        if (drawer.style.display === 'none') {
            drawer.style.display = 'flex';
            if (icon) {
                icon.textContent = '▲ 닫기';
                icon.style.color = '#fff';
            }
            // Render chart after a brief timeout to let display: flex take effect
            setTimeout(() => {
                renderRecPortfolioChart(pfId, '5y');
            }, 50);
        } else {
            drawer.style.display = 'none';
            if (icon) {
                icon.textContent = '▼ 상세 비교';
                icon.style.color = 'var(--text-secondary)';
            }
            if (recChartInstances[pfId]) {
                recChartInstances[pfId].destroy();
                delete recChartInstances[pfId];
            }
        }
    }
};

function renderRecommendedComparison() {
    const listEl = document.getElementById('recommend-comparison-list');
    const dashboardEl = document.getElementById('recommend-comparison-dashboard');
    if (!listEl || !dashboardEl) return;

    listEl.innerHTML = '';
    
    // 1. Get active items in portfolio
    const activeItems = portfolio.filter(p => p.quantity > 0);
    
    if (activeItems.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 2rem 1.5rem; font-size: 0.9rem; background: rgba(255,255,255,0.01); border: 1px dashed rgba(255,255,255,0.1); border-radius: 0.75rem; width: 100%;">
                현재 보유 중인 포트폴리오 자산이 없어 추천 전략과의 적합도 분석을 진행할 수 없습니다.<br>
                <span style="font-size: 0.8rem; opacity: 0.7; margin-top: 0.5rem; display: block;">먼저 자산 관리 리스트에 종목을 추가하고 수량을 입력해 주세요.</span>
            </div>
        `;
        return;
    }

    // 2. Calculate user weights
    let totalKrw = 0;
    const userWeights = {};
    
    activeItems.forEach(item => {
        let price = currentPortfolioPrices[item.key] || 0;
        // Synchronously check if chart has price
        if (charts[item.key] && charts[item.key].data.datasets[0].data.length > 0) {
            const chartData = charts[item.key].data.datasets[0].data;
            const lastData = chartData[chartData.length - 1];
            price = lastData.y !== undefined ? lastData.y : lastData.c;
        }
        
        let isKrw = item.ticker.endsWith('.KS') || item.ticker.endsWith('.KQ') || item.ticker === '^KS11' || item.ticker === '^KQ11';
        const valKrw = (isKrw ? price : price * exchangeRate) * item.quantity;
        totalKrw += valKrw;
        userWeights[item.ticker] = (userWeights[item.ticker] || 0) + valKrw;
    });

    if (totalKrw > 0) {
        // Convert to ratios
        Object.keys(userWeights).forEach(ticker => {
            userWeights[ticker] = userWeights[ticker] / totalKrw;
        });
    } else {
        listEl.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 2rem 1.5rem; font-size: 0.9rem; background: rgba(255,255,255,0.01); border: 1px dashed rgba(255,255,255,0.1); border-radius: 0.75rem; width: 100%;">
                포트폴리오 자산 가치를 계산하는 중입니다. 잠시 후 다시 열어주세요.
            </div>
        `;
        return;
    }

    // 3. For each recommended portfolio, calculate similarity score based on categories
    RECOMMENDED_PORTFOLIOS.forEach(pf => {
        const cats = STRATEGY_CATEGORIES[pf.id] || [];
        const userAlloc = {};
        cats.forEach(c => { userAlloc[c.key] = 0; });
        userAlloc['other'] = 0;

        // Group user weights into strategy categories
        activeItems.forEach(item => {
            const catKey = classifyAssetForStrategy(item.ticker, item.companyName || item.name, pf.id);
            if (userAlloc[catKey] !== undefined) {
                userAlloc[catKey] += userWeights[item.ticker];
            } else {
                userAlloc['other'] += userWeights[item.ticker];
            }
        });

        // Compute L1 distance error across categories
        let sumError = 0;
        cats.forEach(c => {
            const uW = userAlloc[c.key] || 0;
            const tW = c.ratio;
            sumError += Math.abs(uW - tW);
        });
        // Add 'other' category error if user holds non-matching assets
        const otherUW = userAlloc['other'] || 0;
        sumError += Math.abs(otherUW - 0.0);

        // Fit score = 100 - (50 * sumError)
        let fitScore = Math.round(100 - (50 * sumError));
        fitScore = Math.max(0, Math.min(100, fitScore));

        // Generate table rows for category comparison
        let tableRows = '';
        cats.forEach(c => {
            const uW = userAlloc[c.key] || 0;
            const tW = c.ratio;
            const diff = uW - tW;
            const diffPct = Math.round(diff * 100);
            
            let status = '';
            if (Math.abs(diff) < 0.03) {
                status = '<span style="color: #4ade80; font-weight: 700;">✅ 적합</span>';
            } else if (diff <= -0.03) {
                if (uW === 0) {
                    status = '<span style="color: #fda4af; font-weight: 700;">❌ 미보유</span>';
                } else {
                    status = `<span style="color: #fda4af; font-weight: 700;">🔻 부족 (${diffPct}%)</span>`;
                }
            } else {
                status = `<span style="color: #4ade80; font-weight: 700;">🔺 초과 (+${diffPct}%)</span>`;
            }

            tableRows += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 6px 8px; color: #cbd5e1;">${c.label}</td>
                    <td style="padding: 6px 8px; text-align: right; color: var(--text-secondary); font-family: monospace;">${(tW*100).toFixed(0)}%</td>
                    <td style="padding: 6px 8px; text-align: right; color: #fff; font-family: monospace; font-weight: 600;">${(uW*100).toFixed(0)}%</td>
                    <td style="padding: 6px 8px; text-align: right;">${status}</td>
                </tr>
            `;
        });

        // Add row for 'other' category if user holds other assets
        if (userAlloc['other'] > 0) {
            tableRows += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 6px 8px; color: #cbd5e1;">기타 미추천 자산</td>
                    <td style="padding: 6px 8px; text-align: right; color: var(--text-secondary); font-family: monospace;">0%</td>
                    <td style="padding: 6px 8px; text-align: right; color: #fda4af; font-family: monospace; font-weight: 600;">${(userAlloc['other']*100).toFixed(0)}%</td>
                    <td style="padding: 6px 8px; text-align: right;"><span style="color: #fda4af; font-weight: 700;">🔺 초과 (+${Math.round(userAlloc['other']*100)}%)</span></td>
                </tr>
            `;
        }

        // Generate mapped assets text
        let mappedHtml = '';
        cats.forEach(c => {
            const matchedItems = activeItems.filter(item => classifyAssetForStrategy(item.ticker, item.companyName || item.name, pf.id) === c.key);
            if (matchedItems.length > 0) {
                const itemNames = matchedItems.map(item => {
                    const dispName = getKoreanName(item.ticker, item.companyName || item.name);
                    const pct = (userWeights[item.ticker] * 100).toFixed(0);
                    return `<span style="color: #fff; font-weight: 500;">${dispName}</span> (${pct}%)`;
                }).join(', ');
                mappedHtml += `<div style="margin-bottom: 4px;">• <strong>${c.label.split(' ')[0]}</strong>: ${itemNames}</div>`;
            }
        });

        const otherItems = activeItems.filter(item => {
            const catKey = classifyAssetForStrategy(item.ticker, item.companyName || item.name, pf.id);
            return catKey === 'other';
        });
        if (otherItems.length > 0) {
            const itemNames = otherItems.map(item => {
                const dispName = getKoreanName(item.ticker, item.companyName || item.name);
                const pct = (userWeights[item.ticker] * 100).toFixed(0);
                return `<span style="color: #fda4af;">${dispName}</span> (${pct}%)`;
            }).join(', ');
            mappedHtml += `<div style="margin-bottom: 4px;">• <strong>미추천/기타 자산</strong>: ${itemNames}</div>`;
        }

        if (!mappedHtml) mappedHtml = '<div style="color: var(--text-secondary); italic;">맵핑된 자산 없음</div>';

        // Generate advice
        let adviceHtml = '';
        if (pf.id === 'core_satellite') {
            const coreVal = userAlloc['core'] || 0;
            if (coreVal < 0.70) {
                adviceHtml = `핵심 자산(지수형 ETF)의 비중이 권장 비중(70%)보다 낮습니다 (${Math.round(coreVal*100)}%). 안정적인 뼈대를 위해 대표 지수 추종 ETF인 <strong>TIGER 미국S&P500 (360750.KS)</strong> 등을 추가 매수하여 핵심 비중을 늘리세요.`;
            } else {
                adviceHtml = `핵심 자산 비중이 충분하여 포트폴리오의 뼈대가 매우 안정적입니다 (${Math.round(coreVal*100)}%). 위성 자산의 비중 내에서 개별 종목이나 테마 ETF를 통해 알파 초과수익을 노릴 수 있습니다.`;
            }
        } else if (pf.id === 'all_weather_var') {
            const equityVal = userAlloc['equity'] || 0;
            const bondVal = userAlloc['bond'] || 0;
            const goldVal = userAlloc['gold'] || 0;
            const cashVal = userAlloc['cash'] || 0;
            
            const missing = [];
            if (bondVal === 0) missing.push('장기채권');
            if (goldVal === 0) missing.push('금현물');
            if (cashVal === 0) missing.push('현금성 자산');
            
            if (missing.length > 0) {
                adviceHtml = `포트폴리오에 올웨더 전략의 필수 안전 자산군인 <strong>${missing.join(', ')}</strong>이 없습니다. 시장 급락 시 방어력이 부족할 수 있으므로, <strong>TIGER 미국30년국채커버드콜 (458250.KS)</strong>, <strong>TIGER KRX금현물 (368590.KS)</strong> 등을 확보하여 리스크를 낮추세요.`;
            } else if (equityVal > 0.45) {
                adviceHtml = `주식 자산 비중(${Math.round(equityVal*100)}%)이 올웨더 목표 비중(35%)을 크게 상회합니다. 주식 자산 일부를 매도하고 장기채권 및 금현물의 비중을 늘려 자산 배분의 균형을 회복하세요.`;
            } else {
                adviceHtml = `모든 자산군(주식, 채권, 금현물, 현금성)이 조화롭게 편입되어 있습니다. 주기적으로 리밸런싱을 수행하여 목표 비율(35:45:15:5)을 유지하세요.`;
            }
        } else if (pf.id === 'k_valueup_dividend') {
            const valupVal = userAlloc['valueup'] || 0;
            const divVal = userAlloc['dividend'] || 0;
            const finVal = userAlloc['financial'] || 0;
            
            if (valupVal === 0 && divVal === 0) {
                adviceHtml = `밸류업 모멘텀 및 배당 성장 Core ETF가 편입되어 있지 않습니다. 배당 인컴 흐름을 구축하기 위해 <strong>KODEX 코리아밸류업 (495120.KS)</strong> 및 <strong>ARIRANG 고배당주 (161510.KS)</strong> 비중을 늘려주세요.`;
            } else if (finVal === 0) {
                adviceHtml = `주주환원율 및 현금흐름이 확실한 대형 금융/지주사 개별주가 누락되어 있습니다. 안정적인 배당원천을 위해 <strong>KB금융 (105560.KS)</strong> 등을 포트폴리오의 20% 수준으로 편입해 보세요.`;
            } else {
                adviceHtml = `한국형 밸류업 및 배당성장 자산이 적절히 융합되어 매월 안정적인 배당금 흐름이 가능합니다. 주가순자산비율(PBR) 및 배당수익률 추이를 추적하세요.`;
            }
        } else if (pf.id === 'sector_momentum') {
            const sec1Val = userAlloc['sector1'] || 0;
            const sec2Val = userAlloc['sector2'] || 0;
            const cashVal = userAlloc['cash'] || 0;
            
            if (sec1Val === 0 && sec2Val === 0) {
                adviceHtml = `당월 주도 섹터(AI반도체, AI전력인프라 등) 모멘텀 ETF가 편입되지 않았습니다. 초과 수익률 추구를 위해 <strong>KODEX AI반도체TOP2플러스 (395160.KS)</strong> 등을 비중에 맞춰 구성해 보세요.`;
            } else if (cashVal < 0.10) {
                adviceHtml = `시장 변동 시 대피할 현금성/채권 자산 비중이 부족합니다. 안정적인 리스크 통제를 위해 <strong>KODEX CD금리액티브 (459580.KS)</strong> 비중을 20% 수준까지 확대하여 대기 자금을 보강하세요.`;
            } else {
                adviceHtml = `주도주 모멘텀 비중과 대피소 현금 자산이 훌륭히 유지되고 있습니다. 시장 급락(코스피 60일선 붕괴) 감지 시 현금 비중을 적극 확대하세요.`;
            }
        }

        const allocationBarsHTML = pf.allocations.map((a, i) => `
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
                    <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${ALLOC_COLORS[i]}; flex-shrink: 0;"></span>
                        <span style="color: #cbd5e1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${a.label}</span>
                    </div>
                    <span style="color: #fff; font-weight: 700; font-family: monospace; margin-left: 8px;">${(a.ratio * 100).toFixed(0)}%</span>
                </div>
                <div style="background: rgba(255, 255, 255, 0.04); height: 5px; border-radius: 99px; overflow: hidden;">
                    <div style="background: ${ALLOC_COLORS[i]}; width: ${(a.ratio * 100)}%; height: 100%; border-radius: 99px;"></div>
                </div>
            </div>
        `).join('');

        // Progress bar color based on fit score
        let barColor = 'var(--negative)';
        if (fitScore >= 80) barColor = 'var(--positive)';
        else if (fitScore >= 50) barColor = '#f59e0b';

        // Render card
        const card = document.createElement('div');
        card.className = 'recommend-comparison-card glass-card';
        card.style.cssText = `
            padding: 1.25rem;
            background: rgba(255, 255, 255, 0.01);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 0.75rem;
            margin-bottom: 0.5rem;
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        `;
        
        card.innerHTML = `
            <!-- Header Row -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; cursor: pointer; user-select: none;" onclick="toggleCompDetails('${pf.id}')">
                <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; padding-right: 15px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 1.1rem;">${pf.id === 'core_satellite' ? '🎯' : pf.id === 'all_weather_var' ? '⚖️' : pf.id === 'k_valueup_dividend' ? '💎' : '🚀'}</span>
                        <span style="font-size: 0.95rem; font-weight: 700; color: #fff;">${pf.name}</span>
                        <span class="category-badge" style="background:${pf.categoryColor}15; color:${pf.categoryColor}; border:1px solid ${pf.categoryColor}35; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600; margin-left: 6px;">
                            ${pf.category}
                        </span>
                    </div>
                    <p style="color: var(--text-secondary); font-size: 0.82rem; margin: 4px 0 0 0; line-height: 1.4;">${pf.description}</p>
                </div>
                <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-top: 2px;">
                    <span style="font-size: 0.82rem; font-weight: 800; color: ${barColor}; background: ${barColor}15; padding: 3px 8px; border-radius: 6px; border: 1px solid ${barColor}35; font-family: monospace;">${fitScore}% 적합</span>
                    <span id="toggle-icon-${pf.id}" style="color: var(--text-secondary); font-size: 0.78rem; font-weight: 600;">▼ 상세 비교</span>
                </div>
            </div>
            
            <!-- Progress Bar -->
            <div style="background: rgba(255, 255, 255, 0.04); height: 6px; border-radius: 99px; overflow: hidden; margin-top: 0.65rem;">
                <div style="background: ${barColor}; width: ${fitScore}%; height: 100%; border-radius: 99px; transition: width 0.5s ease;"></div>
            </div>
            
            <!-- Collapsible details drawer -->
            <div id="drawer-${pf.id}" class="comp-details-drawer" style="display: none; margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed rgba(255, 255, 255, 0.08); flex-direction: column; gap: 1.25rem;">
                <!-- Period Chart Section -->
                <div style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">📈 1,000만원 투자금 백테스트 성과 (기간별 차트)</span>
                        <div class="rec-chart-controls" style="display: flex; gap: 4px; background: rgba(255,255,255,0.03); padding: 2px; border-radius: 99px; border: 1px solid rgba(255,255,255,0.05);">
                            <button class="rec-range-btn" data-range="10y" style="font-weight: 600;" onclick="changeRecChartRange('${pf.id}', '10y')">10Y</button>
                            <button class="rec-range-btn" data-range="5y" style="font-weight: 600;" onclick="changeRecChartRange('${pf.id}', '5y')">5Y</button>
                            <button class="rec-range-btn" data-range="3y" style="font-weight: 600;" onclick="changeRecChartRange('${pf.id}', '3y')">3Y</button>
                            <button class="rec-range-btn" data-range="1y" style="font-weight: 600;" onclick="changeRecChartRange('${pf.id}', '1y')">1Y</button>
                        </div>
                    </div>
                    <div class="rec-chart-container" style="height: 240px; position: relative; background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.04); border-radius: 8px; padding: 10px;">
                        <canvas id="rec-chart-${pf.id}" style="width: 100%; height: 100%;"></canvas>
                    </div>
                </div>

                <!-- Stats Grid (CAGR, MDD, Volatility, Sharpe) -->
                <div class="recommend-stats" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; width: 100%;">
                    <div class="stat-box" style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.04); padding: 0.6rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 0.68rem; color: var(--text-secondary); margin-bottom: 4px; font-weight: 600;">연평균 수익률 (CAGR)</div>
                        <div id="cagr-${pf.id}" style="font-size: 0.95rem; font-weight: 700; color: #fff;"><span class="stat-loading">계산 중...</span></div>
                    </div>
                    <div class="stat-box" style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.04); padding: 0.6rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 0.68rem; color: var(--text-secondary); margin-bottom: 4px; font-weight: 600;">최대 낙폭 (MDD)</div>
                        <div id="mdd-${pf.id}" style="font-size: 0.95rem; font-weight: 700; color: #fff;"><span class="stat-loading">계산 중...</span></div>
                    </div>
                    <div class="stat-box" style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.04); padding: 0.6rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 0.68rem; color: var(--text-secondary); margin-bottom: 4px; font-weight: 600;">연 변동성 (Volatility)</div>
                        <div id="vol-${pf.id}" style="font-size: 0.95rem; font-weight: 700; color: #fff;"><span class="stat-loading">계산 중...</span></div>
                    </div>
                    <div class="stat-box" style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.04); padding: 0.6rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 0.68rem; color: var(--text-secondary); margin-bottom: 4px; font-weight: 600;">샤프 지수 (Sharpe)</div>
                        <div id="sharpe-${pf.id}" style="font-size: 0.95rem; font-weight: 700; color: #fff;"><span class="stat-loading">계산 중...</span></div>
                    </div>
                </div>

                <!-- Allocations progress bars -->
                <div class="recommend-allocation-area" style="display: flex; flex-direction: column; gap: 0.75rem; background: rgba(0,0,0,0.25); padding: 0.9rem 1.1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.04); width: 100%;">
                    <span style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">📊 자산 구성 및 목표 비중</span>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        ${allocationBarsHTML}
                    </div>
                </div>

                <!-- Table -->
                <div style="width: 100%;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: left;">
                        <thead>
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary);">
                                <th style="padding: 4px 6px; font-weight: 600;">자산군 구분</th>
                                <th style="padding: 4px 6px; font-weight: 600; text-align: right;">권장 비율</th>
                                <th style="padding: 4px 6px; font-weight: 600; text-align: right;">나의 비율</th>
                                <th style="padding: 4px 6px; font-weight: 600; text-align: right;">상태</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
                
                <!-- Mappings -->
                <div style="font-size: 0.78rem; background: rgba(0, 0, 0, 0.18); padding: 0.6rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.03); color: var(--text-secondary); display: flex; flex-direction: column; gap: 3px; width: 100%;">
                    <span style="color: #e2e8f0; font-weight: 700; display: block; margin-bottom: 2px;">📂 보유 자산 분류 (맵핑) 현황</span>
                    ${mappedHtml}
                </div>
                
                <!-- Guide -->
                <div style="font-size: 0.78rem; color: #cbd5e1; line-height: 1.5; border-left: 3px solid #3b82f6; padding-left: 10px; background: rgba(59, 130, 246, 0.02); padding-top: 6px; padding-bottom: 6px; border-radius: 0 8px 8px 0; width: 100%;">
                    💡 <strong>비중 조정 가이드:</strong> ${adviceHtml}
                </div>
            </div>
        `;
        listEl.appendChild(card);
    });
}

function createPieChart(canvasId, allocations) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const pieCtx = canvas.getContext('2d');
    if (!pieCtx) return;
    if (pieChartInstances[canvasId]) pieChartInstances[canvasId].destroy();
    pieChartInstances[canvasId] = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
            labels: allocations.map(a => a.label),
            datasets: [{
                data: allocations.map(a => +(a.ratio*100).toFixed(1)),
                backgroundColor: allocations.map((_, i) => ALLOC_COLORS[i] + 'bb'),
                borderColor:     allocations.map((_, i) => ALLOC_COLORS[i]),
                borderWidth: 2, hoverOffset: 6
            }]
        },
        options: {
            responsive: false, cutout: '62%',
            animation: { duration: 700 },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ' ' + ctx.label.split('(')[0].trim() + ': ' + ctx.raw + '%' } }
            }
        }
    });
}

async function loadRecStats() {
    const allTickers = [...new Set(
        RECOMMENDED_PORTFOLIOS.flatMap(pf => pf.allocations.map(a => a.ticker))
    )];
    for (const ticker of allTickers) {
        if (recTickerCache[ticker]) continue;
        const yahooUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=10y&_=' + Date.now();
        const data = await fetchWithFallback(yahooUrl, 5000);
        const res  = data && data.chart && data.chart.result && data.chart.result[0];
        
        let success = false;
        if (res && res.timestamp && res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) {
            const ts = res.timestamp, pr = res.indicators.quote[0].close;
            recTickerCache[ticker] = [];
            for (let j = 0; j < ts.length; j++) {
                if (pr[j] != null) recTickerCache[ticker].push({ t: ts[j]*1000, p: pr[j] });
            }
            if (recTickerCache[ticker].length > 0) success = true;
        }
        
        if (!success) {
            console.warn(`loadRecStats: Yahoo Finance failed for ${ticker}, falling back to mock history.`);
            const mock = generateMockHistory(ticker, '5y');
            recTickerCache[ticker] = mock.data.map(d => ({ t: d.time.getTime(), p: d.price }));
        }
        
        updateAllRecStats();
        await sleep(500);
    }
    recStatsLoaded = true;
    // 모든 로드 완료 후 여전히 "계산 중..."인 항목 → "데이터 없음" 표시
    finalizeRecStats();
}

// API 데이터 없을 때 "계산 중..." 대신 "데이터 없음" 표시
function finalizeRecStats() {
    RECOMMENDED_PORTFOLIOS.forEach(pf => {
        const cagrEl = document.getElementById('cagr-' + pf.id);
        const mddEl  = document.getElementById('mdd-'  + pf.id);
        const volEl  = document.getElementById('vol-'  + pf.id);
        const sharpeEl = document.getElementById('sharpe-' + pf.id);
        
        if (cagrEl && cagrEl.querySelector('.stat-loading')) {
            cagrEl.innerHTML = '<span style="color:#64748b;font-size:0.85em;">데이터 없음</span>';
        }
        if (mddEl && mddEl.querySelector('.stat-loading')) {
            mddEl.innerHTML = '<span style="color:#64748b;font-size:0.85em;">데이터 없음</span>';
        }
        if (volEl && volEl.querySelector('.stat-loading')) {
            volEl.innerHTML = '<span style="color:#64748b;font-size:0.85em;">데이터 없음</span>';
        }
        if (sharpeEl && sharpeEl.querySelector('.stat-loading')) {
            sharpeEl.innerHTML = '<span style="color:#64748b;font-size:0.85em;">데이터 없음</span>';
        }
    });
}

function updateAllRecStats() {
    RECOMMENDED_PORTFOLIOS.forEach(pf => {
        const stats  = calcRecStats(pf);
        const cagrEl = document.getElementById('cagr-' + pf.id);
        const mddEl  = document.getElementById('mdd-'  + pf.id);
        const volEl  = document.getElementById('vol-'  + pf.id);
        const sharpeEl = document.getElementById('sharpe-' + pf.id);
        
        if (!cagrEl || !mddEl || !volEl || !sharpeEl || !stats) return;
        
        const sign = stats.cagr >= 0 ? '+' : '';
        const cls  = stats.cagr >= 0 ? 'positive' : 'negative';
        cagrEl.innerHTML = '<span class="' + cls + '">' + sign + stats.cagr.toFixed(2) + '%</span>';
        mddEl.innerHTML  = '<span class="negative">-' + stats.mdd.toFixed(2) + '%</span>';
        volEl.innerHTML  = '<span style="color: #cbd5e1;">' + stats.volatility.toFixed(2) + '%</span>';
        
        const sharpeColor = stats.sharpe >= 1.0 ? '#10b981' : (stats.sharpe < 0 ? '#ef4444' : '#fbbf24');
        sharpeEl.innerHTML = `<span style="color: ${sharpeColor}; font-weight: 700;">${stats.sharpe.toFixed(2)}</span>`;

        // Re-render chart if the drawer is open
        const drawer = document.getElementById(`drawer-${pf.id}`);
        if (drawer && drawer.style.display === 'flex') {
            let activeRange = '5y';
            const activeBtn = drawer.querySelector('.rec-range-btn.active');
            if (activeBtn) {
                activeRange = activeBtn.getAttribute('data-range');
            }
            renderRecPortfolioChart(pf.id, activeRange);
        }
    });
}

function calcRecStats(pf, rangeKey = '10y') {
    if (!pf.allocations.every(a => recTickerCache[a.ticker] && recTickerCache[a.ticker].length > 0)) return null;
    const earliestT = Math.max.apply(null, pf.allocations.map(a => recTickerCache[a.ticker][0].t));
    const endT   = Math.min.apply(null, pf.allocations.map(a => recTickerCache[a.ticker][recTickerCache[a.ticker].length-1].t));
    if (earliestT >= endT) return null;

    let startT = earliestT;
    const msInYear = 365.25 * 24 * 60 * 60 * 1000;
    if (rangeKey === '1y') {
        startT = Math.max(earliestT, endT - 1 * msInYear);
    } else if (rangeKey === '3y') {
        startT = Math.max(earliestT, endT - 3 * msInYear);
    } else if (rangeKey === '5y') {
        startT = Math.max(earliestT, endT - 5 * msInYear);
    } else if (rangeKey === '10y') {
        startT = Math.max(earliestT, endT - 10 * msInYear);
    }

    const maps = pf.allocations.map(a => {
        const m = {};
        recTickerCache[a.ticker].forEach(d => { m[d.t] = d.p; });
        return m;
    });
    const initPrices = pf.allocations.map((a) => {
        const first = recTickerCache[a.ticker].find(d => d.t >= startT);
        return first ? first.p : null;
    });
    if (initPrices.some(p => !p)) return null;

    const tsSet = new Set();
    pf.allocations.forEach(a => {
        recTickerCache[a.ticker].forEach(d => { if (d.t >= startT && d.t <= endT) tsSet.add(d.t); });
    });
    const sorted = Array.from(tsSet).sort((a, b) => a - b);
    if (sorted.length < 2) return null;

    const lastP  = initPrices.slice();
    const values = sorted.map(t => {
        pf.allocations.forEach((a, i) => { if (maps[i][t] != null) lastP[i] = maps[i][t]; });
        return pf.allocations.reduce((s, a, i) => s + a.ratio * (lastP[i] / initPrices[i]) * 100, 0);
    });

    const firstVal = values[0], lastVal = values[values.length-1];
    const years = (sorted[sorted.length-1] - sorted[0]) / (365.25 * 864e5);
    const cagr  = years > 0 ? (Math.pow(lastVal / firstVal, 1 / years) - 1) * 100 : 0;

    let peak = values[0], mdd = 0;
    values.forEach(v => {
        if (v > peak) peak = v;
        const dd = (peak - v) / peak;
        if (dd > mdd) mdd = dd;
    });

    // Calculate Volatility and Sharpe Ratio
    const returns = [];
    for (let i = 1; i < values.length; i++) {
        returns.push((values[i] - values[i-1]) / values[i-1]);
    }
    const n = returns.length;
    let volatility = 0;
    let sharpe = 0;
    if (n >= 2) {
        const avg = returns.reduce((sum, val) => sum + val, 0) / n;
        const variance = returns.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / (n - 1);
        const dailyVol = Math.sqrt(variance);
        volatility = dailyVol * Math.sqrt(252) * 100; // annualized in %
        sharpe = volatility > 0 ? (cagr - 2.5) / volatility : 0; // risk-free rate assumed at 2.5%
    }

    return { cagr, mdd: mdd * 100, volatility, sharpe };
}

window.selectRecommendedPortfolio = async function(pfId) {
    const pf = RECOMMENDED_PORTFOLIOS.find(p => p.id === pfId);
    if (!pf) return;

    // ── 덮어쓰기 확인 다이얼로그 ──────────────────────────────
    if (portfolio.length > 0) {
        const ok = confirm(
            `현재 포트폴리오를 "${pf.name}"으로 교체하시겠습니까?\n기존 포트폴리오는 모두 사라집니다.`
        );
        if (!ok) return;
    }

    // 버튼 상태: 버튼이 disabled되기 전에 참조를 저장
    const btn = document.querySelector(`[onclick="selectRecommendedPortfolio('${pf.id}')"]`);
    if (btn) { btn.textContent = '적용 중...'; btn.disabled = true; }

    try {
        const TOTAL_KRW = 10000000;

        // USD/KRW 환율 조회
        let rate = exchangeRate || 1350;
        if (recTickerCache['KRW=X'] && recTickerCache['KRW=X'].length > 0) {
            rate = recTickerCache['KRW=X'][recTickerCache['KRW=X'].length - 1].p;
        } else {
            const rateRes = await fetchRealData('KRW=X', '1d', 2);
            if (rateRes && rateRes.data && rateRes.data.length > 0) {
                rate = rateRes.data[rateRes.data.length - 1].price;
                exchangeRate = rate;
            }
        }

        const totalUSD = TOTAL_KRW / rate;
        const newPortfolio = [];

        for (const alloc of pf.allocations) {
            const ticker = alloc.ticker;
            const key = 'custom_' + ticker.replace(/[^A-Z0-9]/g, '');

            // indices 등록 (없는 경우)
            if (!indices[key]) {
                const ci = Object.keys(indices).length % neonColors.length;
                indices[key] = {
                    name: ticker,
                    ticker: ticker,
                    color: neonColors[ci].color,
                    backgroundColor: neonColors[ci].bg,
                    elementId: key,
                    companyName: ticker
                };
            }

            // 가격 조회: recTickerCache 우선, 없으면 API 신규 호출
            let currentPrice = null;
            let prevClose = null;
            if (recTickerCache[ticker] && recTickerCache[ticker].length > 0) {
                currentPrice = recTickerCache[ticker][recTickerCache[ticker].length - 1].p;
                if (recTickerCache[ticker].length > 1) {
                    prevClose = recTickerCache[ticker][recTickerCache[ticker].length - 2].p;
                }
            } else {
                const priceRes = await fetchRealData(ticker, '1d', 3);
                if (priceRes && priceRes.data && priceRes.data.length > 0) {
                    currentPrice = priceRes.data[priceRes.data.length - 1].price;
                    prevClose = priceRes.previousClose;
                    if (priceRes.companyName) indices[key].companyName = priceRes.companyName;
                }
                await sleep(300);
            }

            // 포트폴리오 탭 전환 시 즉시 KRW 금액 표시 (Loading 방지)
            if (currentPrice) {
                currentPortfolioPrices[key] = currentPrice;
                if (prevClose) {
                    currentPortfolioPrevCloses[key] = prevClose;
                }
            }

            // 1천만원 기준으로 수량 계산
            const allocUSD = totalUSD * alloc.ratio;
            const quantity = currentPrice ? Math.floor(allocUSD / currentPrice) : 0;

            newPortfolio.push({
                key,
                ticker,
                name: ticker,
                companyName: indices[key].companyName || ticker,
                quantity
            });
        }

        // ── 포트폴리오 교체 + 탭 이동 ───────────────────────
        portfolio.splice(0, portfolio.length);
        newPortfolio.forEach(item => portfolio.push(item));
        savePortfolio();
        updateDashboardPortfolioButtons();
        document.querySelector('[data-tab="portfolio"]').click();
        const recommendModal = document.getElementById('recommend-modal');
        if (recommendModal) {
            recommendModal.classList.remove('active');
        }
        alert(`"${pf.name}" 포트폴리오가 적용되었습니다!`);

    } catch (e) {
        console.error(e);
        alert('포트폴리오 적용 중 오류가 발생했습니다.');
    } finally {
        if (btn) { btn.textContent = '이 포트폴리오 선택'; btn.disabled = false; }
    }
};

// ==========================================
// Analysis Report Logic
// ==========================================

const ACTUAL_REPORTS = {
    '005930.KS': {
        summary: "삼성전자는 최근 반도체 업황 회복세와 고대역폭 메모리(HBM) 공급 본격화로 이익 개선 모멘텀을 맞이하고 있습니다. 특히 AI 서버향 고부가가치 D램 제품의 비중 확대가 영업이익 상승의 주 원동력입니다. 파운드리 부문의 선단 공정 수율 안정화와 온디바이스 AI 시장의 스마트폰 판매 성장세가 지속적인 상승 요인으로 꼽히며, 매력적인 밸류에이션 구간에 위치해 있습니다.",
        points: [
            "HBM3E/HBM4 공급 계약 확대로 고부가가치 메모리 시장 주도권 회복",
            "온디바이스 AI를 탑재한 갤럭시 S시리즈 및 폴더블폰의 프리미엄 판매 호조",
            "선단 공정(3nm 이하) 파운드리 수율 개선에 따른 신규 고객사 수주 가속화",
            "견고한 현금 흐름 기반의 분기 배당 등 주주 환원 정책 지속"
        ]
    },
    '005930': {
        summary: "삼성전자는 최근 D램 가격 상승과 AI 서버 반도체 수요 폭증의 수혜로 견고한 마진 확대를 경험하고 있습니다. HBM(고대역폭 메모리) 생산설비 가속화와 온디바이스 AI 디바이스 출시가 겹치며 스마트폰과 칩 사업부 전반에서 시너지가 나고 있습니다. 매력적인 배당 수익률과 낮은 밸류에이션이 돋보입니다.",
        points: [
            "인공지능 가속기용 초고속 HBM 공급 확대로 실적 턴어라운드 본격화",
            "스마트폰 및 프리미엄 IT 디바이스의 AI 통합 모델 판매 증가",
            "파운드리 수율 다각화에 따른 글로벌 선도 설계 기업(Fabless) 수주 성공",
            "우수한 재무 건전성 및 주주 친화적인 분기 배당 규모 유지"
        ]
    },
    '000660.KS': {
        summary: "SK하이닉스는 고대역폭 메모리(HBM) 시장에서의 선도적인 기술 리절십을 바탕으로 차세대 AI 메모리 반도체 공급을 독점하며 폭발적인 실적 성장을 달성하고 있습니다. NVIDIA와의 견고한 동맹 관계 속에서 HBM3E 및 HBM4 시장을 선점하였으며, 고용량 eSSD 등 기업용 스토리지 시장의 동반 성장 수혜를 누리고 있습니다. 범용 D램 및 낸드(NAND) 가격의 턴어라운드와 감산 조치에 따른 재고 건전화가 전사 수익성을 극대화시키고 있습니다.",
        points: [
            "HBM3E 차세대 제품의 독점적 지배력 유지 및 글로벌 빅테크향 본격 출하량 증가",
            "생성형 AI 데이터센터 건설 붐에 따른 초고속 기업용 eSSD(솔리다임 포함) 매출 폭증",
            "메모리 반도체 미세공정 전환(1b나노) 고도화에 따른 압도적인 제조 원가 경쟁력 확보",
            "레거시 제품의 수급 균형 회복에 따른 영업이익률의 V자형 턴어라운드 본격화"
        ]
    },
    '000660': {
        summary: "SK하이닉스는 고대역폭 메모리(HBM) 시장에서의 선도적인 기술 리더십을 바탕으로 차세대 AI 메모리 반도체 공급을 독점하며 폭발적인 실적 성장을 달성하고 있습니다. NVIDIA와의 견고한 동맹 관계 속에서 HBM3E 및 HBM4 시장을 선점하였으며, 고용량 eSSD 등 기업용 스토리지 시장의 동반 성장 수혜를 누리고 있습니다. D램 가격의 턴어라운드가 전사 수익성을 극대화시키고 있습니다.",
        points: [
            "HBM3E 차세대 제품의 독점적 지배력 유지 및 글로벌 빅테크향 본격 출하량 증가",
            "생성형 AI 데이터센터 건설 붐에 따른 초고속 기업용 eSSD 매출 폭증",
            "메모리 반도체 미세공정 전환 고도화에 따른 압도적인 제조 원가 경쟁력 확보",
            "영업이익률의 V자형 턴어라운드 본격화"
        ]
    },
    '035420.KS': {
        summary: "NAVER는 독보적인 국내 포털 지배력을 중심으로 AI 검색 서비스인 '큐:(Cue:)'와 기업용 하이퍼클로바X(HyperCLOVA X) 클라우드 모델을 전방위적으로 연동하며 한국형 생성 AI 비즈니스를 선도하고 있습니다. 검색 광고의 높은 견조함 위에 스마트스토어 연동 상거래(Commerce) 수수료 모델 다각화, 네이버페이를 연계한 핀테크 생태계 락인(Lock-in)이 지속되고 있으며, 일본 라인 야후 지분 구조 안정화를 통한 글로벌 사업 재정비를 모색 중입니다.",
        points: [
            "하이퍼클로바X 중심의 B2B 기업 전용 생성형 AI 솔루션 및 보안 클라우드 수주 가속화",
            "개인 맞춤형 추천 피드(Home) 도입으로 검색 광고 단가(ARPU) 및 체류 시간의 반등 성공",
            "도착보장 서비스 유료화 및 네이버플러스 멤버십 혜택 강화를 통한 커머스 매출 성장성 제고",
            "웹툰 엔터테인먼트(Webtoon Entertainment) 미국 상장 성공에 따른 글로벌 IP 지식재산권 가치 재평가"
        ]
    },
    '035720.KS': {
        summary: "카카오는 국민 메신저 카카오톡의 탭 개편 및 비즈보드 광고 효율 극대화를 통해 압도적인 트래픽 기반의 안정적 캐시카우를 입증하고 있습니다. 카카오뱅크, 카카오페이 등 금융 자회사의 실적 성장세가 가파르며, 에스엠(SM) 엔터테인먼트 인수를 통한 글로벌 K-콘텐츠 유통 확장세가 돋보입니다. 인공지능 연구 자회사인 카카오브레인과의 합병 이후 카카오톡 서비스 내 실생활 밀착형 경량 AI 비전을 순차 도입하며 체질 개선을 가속화하고 있습니다.",
        points: [
            "카카오톡 '친구 탭' 및 '오픈채팅 탭' 개인화 광고 도입에 따른 B2B 비즈니스 매출 다각화",
            "모빌리티, 페이 등 주요 계열사의 만성 적자 축소 및 유통 비용 효율화를 통한 영업이익률 개선",
            "SM엔터테인먼트 해외 퍼블리싱 체인 통합으로 K-POP 아티스트 글로벌 IP 매출의 동반 시너지",
            "대화형 실생활 비서 AI 모델 탑재를 통한 플랫폼 경쟁력 확보"
        ]
    },
    '005380.KS': {
        summary: "현대자동차는 제네시스(Genesis) 등 프리미엄 라인업 판매 비중 증가와 고부가가치 하이브리드(HEV) 차량의 폭발적 수요에 탄력적으로 대응하며 역대 최대 영업이익 실적을 경신하고 있습니다. 미국 앨라배마 및 조지아 신공장(HMGMA) 가동으로 북미 시장 현지 생산 공급망을 최적화했으며, 전기차(EV) 캐즘 우려에도 불구하고 업계 최고 수준의 제조 원가 경쟁력을 바탕으로 두 자릿수 영업이익률을 수성하고 있습니다. 적극적인 자사주 매입 및 높은 주당 배당금 확대를 통한 밸류업 프로그램의 대표 수혜주로 평가받습니다.",
        points: [
            "전기차 캐즘 우려를 상쇄하는 고마진 하이브리드(HEV) 차종의 유연한 글로벌 교차 생산 체계 운영",
            "Genesis 프리미엄 차종 및 대형 SUV 판매 증가에 따른 글로벌 ASP(평균 판매가) 극대화",
            "미국 조지아주 메타플랜트 신공장 가동을 통한 북미 IRA 세제 혜택 최대 수혜 및 판매량 증가",
            "인도 법인(Hyundai Motor India)의 현지 IPO 추진에 따른 유동성 확보 및 신흥국 모빌리티 장악"
        ]
    },
    '009150.KS': {
        summary: "삼성전기는 AI 데이터센터 및 온디바이스 AI 시장 확대의 직간접적인 최대 수혜 기업입니다. 서버 및 AI용 초고다층 기판(FC-BGA) 부문의 본격 공급 물량이 늘어났으며, 하이엔드 적층세라믹콘덴서(MLCC)의 글로벌 점유율이 견고하게 상승하고 있습니다. 전장(Automotive) 카메라 모듈 및 차량용 고온/고압 MLCC 신제품 라인업 확대로 전통적인 IT 완제품 수요 둔화를 고마진 기판과 수동 부품 매출로 성공적으로 대체하며 질적 성장을 이어가고 있습니다.",
        points: [
            "서버, 네트워크, 자율주행 차량향 프리미엄 고부가가치 FC-BGA 기판의 고속 성장",
            "차량용 및 산업용 하이엔드 극소형 고용량 MLCC(적층세라믹콘덴서) 공급 증가에 따른 수익성 향상",
            "글로벌 스마트폰 제조사향 폴디드 줌(Folded Zoom) 초고소형 카메라 모듈의 독보적 수주 경쟁력",
            "AI 칩 구동용 고성능 파워인덕터 등 차세대 수동부품 시장의 성공적인 선점 및 매출 기여"
        ]
    },
    '373220.KS': {
        summary: "LG에너지솔루션은 글로벌 완성차 업체들과의 대규모 합작 공장(JV) 설립을 기반으로 미국 인플레이션 감축법(IRA)에 따른 첨단 제조 생산 세액공제(AMPC) 혜택을 극대화하여 독보적인 실적 방어선을 구축하고 있습니다. 차세대 원통형 4680 배터리 공급 양산 체제를 성공적으로 완비하였으며, LFP(리튬인산철) 배터리 다각화 전략과 에너지저장장치(ESS) 시장 침투를 통해 시장 캐즘 우려 속에서도 중장기적인 글로벌 1위 경쟁력을 입증하고 있습니다.",
        points: [
            "얼려움셀즈(GM 합작법인) 및 혼다, 현대차 등 북미 내 대규모 합작공장의 본격 가동 시너지",
            "북미 시장 중심의 원격 에너지 저장장치(ESS) 및 LFP 배터리 공급 수주 확대를 통한 포트폴리오 다각화",
            "원통형 46시리즈 배터리 선제 공급 계약 완료에 따른 기술 장벽 구축 및 양산 효율 극대화",
            "친환경 리사이클링 및 폐배터리 업사이클링 생태계 구축을 통한 안정적인 원자재 확보 벨트 형성"
        ]
    },
    '068270.KS': {
        summary: "셀트리온은 셀트리온헬스케어와의 합병 완료를 통해 거래 투명성을 확보하고 대규모 원가 구조 개선을 달성하며 글로벌 탑티어 바이오시밀러 기업으로 도약하고 있습니다. 세계 최초의 피하주사 제형 인플릭시맙 치료제인 '짐펜트라(Zymfentra)'가 미국 시장 내 신약으로 허가받은 후 처방약급여관리업체(PBM) 등재 리스트를 빠르게 확장하며 고마진 매출을 본격 가속화하고 있습니다. 후속 바이오시밀러 파이프라인의 글로벌 승인 획득으로 안정적인 성장을 구축하고 있습니다.",
        points: [
            "신약으로 출시된 짐펜트라(Zymfentra)의 미국 메이저 PBM 등재 및 자가면역질환 시장 매출 급증",
            "램시마, 트룩시마, 허쥬마 등 기존 3대 바이오시밀러의 견고한 유럽 시장 점유율 1위 지속",
            "합병 시너지에 따른 원가율의 혁신적 하락(기존 70% 대에서 30% 수준)으로 영업이익 대폭 반등",
            "유플라이마(휴미라 바이오시밀러) 및 졸레어, 스텔라라 등 차세대 파이프라인의 연속 승인 모멘텀"
        ]
    },
    'AAPL': {
        summary: "애플은 자체 생성형 AI인 'Apple Intelligence'의 도입과 기기 교체 주기 도래로 강력한 실적 성장이 기대되고 있습니다. 아이폰 판매의 글로벌 회복 흐름과 함께 높은 마진을 자랑하는 서비스 부문(App Store, Apple Music, iCloud 등)의 매출 비중이 사상 최대치를 기록하고 있습니다. 견고한 브랜드 생태계와 20억 대가 넘는 활성 기기가 지속적인 성장의 버팀목입니다.",
        points: [
            "온디바이스 AI 기능 지원으로 전 세계적인 아이폰 신규 교체 수요(슈퍼사이클) 촉진",
            "구독 및 플랫폼 서비스를 포함한 서비스 사업부의 연간 두 자릿수 고마진 성장",
            "비전 프로(Vision Pro) 등 새로운 폼팩터 도입을 통한 공간 컴퓨팅 생태계 선점",
            "대규모 자사주 매입 및 매년 증가하는 배당을 통한 극대화된 주주 가치 환원"
        ]
    },
    'TSLA': {
        summary: "테슬라는 전기차 업계의 치열한 가격 경쟁 속에서도 생산 효율성 개선과 차세대 저가형 모델 출시 준비를 통해 리더십을 유지하고 있습니다. FSD(Full Self-Driving) 베타 버전의 대규모 보급과 인공지능 로봇(Optimus) 사업 고도화는 단순 제조업에서 AI/로보틱스 기업으로의 재평가를 이끌고 있습니다. 에너지 저장 장치(Megapack) 부문의 폭발적인 성장이 새로운 핵심 캐시카우로 부상했습니다.",
        points: [
            "차세대 보급형 플랫폼(2만 5천 달러 대) 출시 예정으로 대중적 EV 시장 독점 강화",
            "FSD 라이센싱 가능성 및 자율주행 택시(Robotaxi) 네트워크 구축 모멘텀",
            "메가팩(Megapack) 등 에너지 저장 시스템(ESS) 매출 및 마진의 전년 대비 폭발적 성장",
            "자체 연산 클러스터(Dojo) 가속화를 통한 자율주행 및 휴머노이드 AI 모델 경쟁 우위 확보"
        ]
    },
    'NVDA': {
        summary: "엔비디아는 전 세계 생성형 AI 열풍 속에서 AI 가속기 시장의 90% 이상을 장점하며 독보적인 독점적 성장을 이어가고 있습니다. 차세대 블랙웰(Blackwell) 아키텍처 칩에 대한 글로벌 빅테크 기업들의 강력한 사전 수요가 향후 몇 년간의 실적을 담보하고 있습니다. 칩 판매뿐만 아니라 CUDA 소프트웨어 생태계를 통한 압도적인 기술 장벽이 경쟁사들의 진입을 어렵게 만들고 있습니다.",
        points: [
            "차세대 Blackwell 가속기의 공급 확대 및 높은 평균 판매가(ASP)에 따른 마진 극대화",
            "글로벌 클라우드 제공업체(CSP) 및 국가 주도 AI 인프라(Sovereign AI)의 강력한 지출 지속",
            "CUDA 소프트웨어 생태계 결속력으로 하드웨어 마이그레이션 방지 장벽 형성",
            "네트워킹 사업 부문(Spectrum-X, InfiniBand)의 고속 성장을 통한 고성능 데이터센터 시너지"
        ]
    },
    'MSFT': {
        summary: "마이크로소프트는 OpenAI와의 파트너십을 기반으로 전 제품군에 생성형 AI인 Copilot을 성공적으로 통합하며 클라우드 시장 성장을 리드하고 있습니다. Azure 클라우드 서비스는 AI 연산 수요 폭증으로 AWS와의 점유율 격차를 급격히 좁히고 있습니다. 기존 오피스 365, 윈도우 등의 B2B 구독 단가 상승(ARPU) 및 액티비전 블리자드 인수를 통한 게이밍 생태계 확장이 성장을 뒷받침하고 있습니다.",
        points: [
            "Azure AI 인프라 매출의 폭발적 기여로 퍼블릭 클라우드 부문 마진 확대",
            "B2B 핵심 소프트웨어(Office 365 Copilot) 유료 가입자의 급격한 증가로 수익성 제고",
            "액티비전 블리자드 인수 완료에 따른 Xbox Game Pass 구독 생태계 및 게임 퍼블리싱 확장",
            "경기 불황에 영향받지 않는 강력한 기업용 클라우드 및 구독 경제 비즈니스 구조"
        ]
    },
    'GOOGL': {
        summary: "알파벳(구글)은 자사의 멀티모달 AI 모델인 '제미나이(Gemini)'를 구글 검색 엔진에 고속 통합하며 AI 검색 시대의 독점적 리더십을 굳히고 있습니다. 클라우드 부문(Google Cloud)은 생성형 AI 개발 연산 수요의 지속 유입으로 고속 성장을 이어가고 있으며, 유튜브(YouTube) 광고 및 구독 서비스 단가 인상이 실적의 든든한 캐시카우 역할을 하고 있습니다. 완전 자율주행 차량 자회사인 웨이모(Waymo)의 유료 운송 서비스 확장세가 장기 성장 잠재력으로 부상하고 있습니다.",
        points: [
            "Gemini 기반 AI Overviews 검색 광고 고효율 결합을 통한 검색 부문 ARPU의 강력한 성장",
            "엔터프라이즈 AI 연산 핵심 도구(Vertex AI) 도입 급증으로 구글 클라우드 마진의 폭발적 상승",
            "유튜브 프리미엄 구독자 유입 가속화 및 숏폼(Shorts) 동영상 광고 매출의 가파른 성장세",
            "Waymo 완전 자율주행 로보택시의 글로벌 주요 대도시 유료 운송 서비스 확장 경쟁력 독점"
        ]
    },
    'GOOG': {
        summary: "알파벳(구글)은 자사의 멀티모달 AI 모델인 '제미나이(Gemini)'를 구글 검색 엔진에 고속 통합하며 AI 검색 시대의 독점적 리더십을 굳히고 있습니다. 클라우드 부문(Google Cloud)은 생성형 AI 개발 연산 수요의 지속 유입으로 고속 성장을 이어가고 있으며, 유튜브(YouTube) 광고 및 구독 서비스 단가 인상이 실적의 든든한 캐시카우 역할을 하고 있습니다. 완전 자율주행 차량 자회사인 웨이모(Waymo)의 유료 운송 서비스 확장세가 장기 성장 잠재력으로 부상하고 있습니다.",
        points: [
            "Gemini 기반 AI Overviews 검색 광고 고효율 결합을 통한 검색 부문 ARPU의 강력한 성장",
            "엔터프라이즈 AI 연산 핵심 도구(Vertex AI) 도입 급증으로 구글 클라우드 마진의 폭발적 상승",
            "유튜브 프리미엄 구독자 유입 가속화 및 숏폼(Shorts) 동영상 광고 매출의 가파른 성장세",
            "Waymo 완전 자율주행 로보택시의 글로벌 주요 대도시 유료 운송 서비스 확장 경쟁력 독점"
        ]
    },
    'AMZN': {
        summary: "아마존은 세계 최대의 퍼블릭 클라우드인 AWS(Amazon Web Services)의 생성형 AI 기반 혁신 솔루션 수요 폭증 and 대규모 데이터센터 설비 투자 확대로 재도약하고 있습니다. 온라인 유통(E-Commerce) 사업 부문은 AI 물류 라우팅 자동화 및 프라임 멤버십 가속 배송 네트워크 효율화에 힘입어 전례 없는 마진 개선을 거두었습니다. 광고 서비스(특히 프라임 비디오 광고 도입)의 강력한 성장이 고효율 영업이익 창출원으로 완전히 자리 잡았습니다.",
        points: [
            "AWS 클라우드 전용 AI 칩(Trainium, Inferentia) 공급 확대를 통한 고마진 AI 클라우드 수주 폭증",
            "배송 거점 로봇 자동화 및 리저널 풀필먼트 네트워크 도입에 따른 물류 원가 배송 비용의 혁신적 하락",
            "Prime Video 비디오 스트리밍 광고 본격 도입에 따른 디지털 마케팅 광고 부문 매출 급성장",
            "연간 Prime 구독 멤버십 연동 생태계 강화 및 AI 검색 상품 추천 결합을 통한 전자상거래 구매 전환률 제고"
        ]
    },
    'META': {
        summary: "메타 플랫폼스는 자체 대형 언어 모델인 'Llama(라마)' 아키텍처를 기반으로 인스타그램 릴스(Reels) 및 페이스북 피드의 추천 정밀도를 고도화하며 타깃 광고 효율을 극적으로 증가시켰습니다. 애플의 개인정보보호 조치(ATT) 타격을 AI 추천 예측 시스템 도입으로 완벽히 극복하였으며, 메타버스 사업 부문(Reality Labs)의 적자 개선 노력과 차세대 스마트 글래스(Ray-Ban Meta)의 폭발적인 대중적 흥행이 신성장 동력으로 조명받고 있습니다. 대규모 밸류업 주주 환원과 탄탄한 자사주 매입이 투심을 주도합니다.",
        points: [
            "Llama AI 아키텍처 기반 맞춤형 타깃 광고 전환 효율 극대화로 기업 광고주 충성도 증가",
            "Instagram Reels 숏폼 추천 가속화에 따른 사용자 일일 체류 시간 및 클릭당 단가의 상승세",
            "Ray-Ban Meta 스마트 글래스 판매 대중화로 온디바이스 일상용 AI 비서 폼팩터 시장 조기 장악",
            "수익성 개선(Cost Discipline) 경영 기조 정착 및 지속적인 사상 최대 현금 배당 환원 정책"
        ]
    },
    'NFLX': {
        summary: "넷플릭스는 계정 공유 유료화 정책과 광고 요금제(Ad-supported tier)의 대성공을 통해 가입자당 평균 단가와 전 세계 구독자 기반을 가파르게 넓히고 있습니다. 로컬 오리지널 콘텐츠 제작 역량 및 막강한 라이브 스포츠 중계권(WWE Raw, NFL 등) 확보를 통해 스트리밍 시장 내 완전한 독주 체제를 강화했습니다. 광고주를 위한 자체 독자 애드테크 플랫폼 런칭 및 강력한 연간 잉여 현금 흐름 창출을 이뤄내며 미디어 산업의 최강자임을 입증하고 있습니다.",
        points: [
            "글로벌 광고형 요금제 가입자의 분기별 전년 대비 두 자릿수 폭발적인 신규 유입",
            "계정 공유 제한 조치의 전 세계적 안착에 따른 단독 프리미엄 가입자 전환율 극대화",
            "WWE, NFL 등 초대형 인기 스포츠 이벤트 라이브 스트리밍 중계권 계약 체결로 락인 효과 강화",
            "압도적인 가입자 규모를 기반으로 한 콘텐츠 제작비 분산 효과 및 두 자릿수 중후반 영업이익률 달성"
        ]
    }
};

function generateDynamicReport(ticker, companyName) {
    const cleanTicker = ticker.toUpperCase();
    if (ACTUAL_REPORTS[cleanTicker]) {
        return ACTUAL_REPORTS[cleanTicker];
    }
    const simpleKey = cleanTicker.split('.')[0];
    if (ACTUAL_REPORTS[simpleKey]) {
        return ACTUAL_REPORTS[simpleKey];
    }

    // Default Smart Dynamic Generator based on the stock properties
    const config = indices[Object.keys(indices).find(key => indices[key].ticker === ticker)] || {};
    const changeEl = document.getElementById(`${config.elementId || ''}-change`);
    let changePctStr = "0.00%";
    let isPositive = true;
    if (changeEl) {
        changePctStr = changeEl.textContent.trim();
        isPositive = !changeEl.classList.contains('negative') && !changePctStr.startsWith('-');
    }

    const isKR = ticker.endsWith('.KS') || ticker.endsWith('.KQ') || ticker === '^KS11' || ticker === '^KQ11';
    
    let sector = "IT/기술혁신";
    let summaryTemplate = "";
    let points = [];

    const lowerName = companyName.toLowerCase();

    if (lowerName.includes('바이오') || lowerName.includes('헬스') || lowerName.includes('제약') || lowerName.includes('셀트') || lowerName.includes('chem') || lowerName.includes('pharma') || lowerName.includes('bio')) {
        sector = "바이오 및 헬스케어";
        summaryTemplate = `${companyName}(${ticker})은(는) 차세대 바이오시밀러 및 신약 파이프라인의 글로벌 임상 승인 성과와 핵심 치료제 시장 공급 확대를 바탕으로 고성능 질적 성장을 견인하고 있습니다. 최근 주가 변동률(${changePctStr})은 글로벌 신약 인허가 일정 및 거시 경제 금리 인하 변수에 영향을 받았으나, 안정적인 글로벌 유통망 조기 안착과 R&D 성과 가속화로 중장기적 파이프라인 가치 재평가가 확실시됩니다.`;
        points = [
            `글로벌 주요 국가(미국, 유럽 등) 내 핵심 바이오시밀러 신규 처방약 급여(PBM) 신속 등재 성과`,
            `독자적인 고난이도 항체치료제 및 차세대 모달리티 플랫폼 R&D 가속화를 통한 원가 장벽 구축`,
            `글로벌 파트너십 유통 효율 강화를 통한 영업 외 비용 구조의 점진적인 흑자 구조 개편 달성`,
            `풍부한 글로벌 현금 흐름을 기반으로 한 후기 임상 파이프라인 인수(M&A) 및 주주 가치 환원 본격화`
        ];
    } else if (lowerName.includes('금융') || lowerName.includes('은행') || lowerName.includes('지주') || lowerName.includes('증권') || lowerName.includes('카드') || lowerName.includes('보험') || lowerName.includes('bank') || lowerName.includes('holdings') || lowerName.includes('capital')) {
        sector = "금융 및 밸류업지주";
        summaryTemplate = `${companyName}(${ticker})은(는) 안정적인 순이자마진(NIM) 유지와 철저한 리스크 관리 체계 확립을 통해 역대급 순이익 성장을 유지하고 있습니다. 최근 변동률(${changePctStr})은 정부의 밸류업 프로그램 관련 외인 수급 변동 및 기준 금리 인하 기대감이 반영된 결과입니다. 향후 비이자 이익 비중 다각화와 업계 최고 수준의 대규모 자사주 매입/소각 기조 확대를 토대로 코리아 디스카운트를 극복하고 극대화된 주주 가치 환원을 실현할 것입니다.`;
        points = [
            `강력한 자본 적정성(CET1 비율)을 기반으로 한 지속적이고 안정적인 분기 배당 제도 수립`,
            `비이자 영업이익(자산관리, 퇴직연금, IB 부문) 수수료 비중 확대를 통한 이익 안정성 극대화`,
            `정부의 밸류업 세제 혜택 가속화 및 연간 3천억 원 규모 이상의 정기적 자사주 소각 추진`,
            `디지털 플랫폼 전환에 따른 지점 운영비의 효율적인 절감 및 철저한 부동산 PF 충당금 선제 적립`
        ];
    } else if (lowerName.includes('에너지') || lowerName.includes('화학') || lowerName.includes('포스코') || lowerName.includes('posco') || lowerName.includes('solar') || lowerName.includes('oil') || lowerName.includes('gas') || lowerName.includes('battery') || lowerName.includes('배터리') || lowerName.includes('소재')) {
        sector = "에너지 및 2차전지/소재";
        summaryTemplate = `${companyName}(${ticker})은(는) 전 세계 친환경 에너지 전환 흐름 속에서 차세대 친환경 소재 및 독보적인 배터리 부품/에너지 유통 인프라 강화를 통해 글로벌 톱티어 경쟁력을 굳히고 있습니다. 최근의 주가 변동률(${changePctStr})은 전기차 일시적 수요 정체(캐즘) 및 글로벌 원자재 광물 단가 하락 요인이 선반영된 결과이며, 핵심 파트너사들과의 중장기 장기 공급 계약 수주 잔고 확보를 통해 견고한 성장 가속화가 이어질 것입니다.`;
        points = [
            `북미 및 유럽 현지 신공장의 조기 완비에 따른 생산 세액공제(AMPC) 인센티브 최대 수혜`,
            `하이니켈 및 차세대 LFP 소재 다각화 전략에 기반한 신규 글로벌 OEM 수주 경쟁 우위 수성`,
            `친환경 탄소배출권 규제 강화 흐름에 부합하는 재생에너지 포트폴리오의 성공적인 상용화`,
            `원자재 광물(리튬, 니켈) 직소싱 벨트 확보를 통한 원가 절감 및 외부 수급 불안정 리스크의 차단`
        ];
    } else {
        // General Technology / Enterprise template adjusted by price change direction
        if (isPositive) {
            summaryTemplate = `${companyName}(${ticker})은(는) 차세대 IT 및 고부가가치 기술 솔루션 시장에서의 핵심 특허 포트폴리오 장악력을 기반으로 견고한 글로벌 시장 경쟁 우위를 입증하고 있습니다. 최근의 주가 강세(${changePctStr})는 생성형 AI 연동 제품 라인업의 성공적인 침투와 글로벌 B2B 고객사 유입 증가가 호조로 작용한 결과이며, 향후 대규모 인프라 선점 투자에 따른 이익 성장 가시성이 한층 돋보일 것으로 기대됩니다.`;
            points = [
                `차세대 IT 혁신 기술 상용화에 성공하여 높은 평균판매단가(ASP)에 기인한 영업마진의 고도화`,
                `클라우드 및 빅데이터 기반 AI 제품 연동 확대를 통한 신규 B2B 고마진 구독 매출 기여 가속화`,
                `고효율 자동화 제조 라인 확대 적용을 통한 생산 공정 관리 최적화 및 고정비 비중 감소`,
                `글로벌 메이저 연계망 강화를 통한 견고한 기술 락인 장벽 확보 및 독보적 진입장벽 형성`
            ];
        } else {
            summaryTemplate = `${companyName}(${ticker})은(는) IT 하드웨어 완제품 수요 및 공급망 재조정에 대응하는 과정에서 핵심 사업 부문의 독보적인 연구개발(R&D)과 고마진 비즈니스 포트폴리오 강화를 주도하고 있습니다. 최근 주가의 단기 조정(${changePctStr})은 글로벌 거시경제 공급 불안정 변수가 일시 반영된 조정 단계로 평가되며, 향후 생산 최적화 원가 절감과 고객 다변화를 실현해 본격적인 턴어라운드를 이끌어 낼 전망입니다.`;
            points = [
                `고성능 부품 및 독자적 R&D 특허 라이센싱 수입 확대를 통한 만성적 원가 구조 극적인 개선`,
                `단기 완제품 수요 정체를 극복하기 위한 신흥국 B2G 및 고마진 기업 커스터마이징 영업 가속화`,
                `재고 건전화 대책 및 글로벌 공급망 다변화를 활용한 부품 매입 단가의 체계적인 축소 달성`,
                `경기 불황 극복을 위한 비핵심 유통 자산의 효율적 유동화 추진 및 강력한 주주 친화적 현금 배당 환원`
            ];
        }
    }

    const summary = summaryTemplate;
    return { summary, points };
}

function getDeterministicFirms(ticker, isIndex, isKRW) {
    // Seed hash from ticker
    let hash = 0;
    for (let i = 0; i < ticker.length; i++) {
        hash = ticker.charCodeAt(i) + ((hash << 5) - hash);
    }
    hash = Math.abs(hash);

    // List of possible Korean securities firms
    const krFirms = [
        "삼성증권", "미래에셋증권", "NH투자증권", "한국투자증권", "KB증권", 
        "신한투자증권", "하나증권", "메리츠증권", "키움증권", "대신증권"
    ];
    // List of possible US securities firms
    const usFirms = [
        "Goldman Sachs", "Morgan Stanley", "JPMorgan Chase", "Bank of America", 
        "Citi", "Wells Fargo", "UBS", "Barclays", "Jefferies", "Deutsche Bank"
    ];
    // List of possible economic research agencies (for indices)
    const krAgencies = [
        "한국은행 (경제전망)", "KDI 경제동향", "대외경제정책연구원", "삼성증권 리서치", 
        "미래에셋증권 리서치", "현대경제연구원", "금융연구원", "자본시장연구원"
    ];
    const usAgencies = [
        "Federal Reserve (Outlook)", "Goldman Sachs Research", "Morgan Stanley Research", 
        "IMF Global Outlook", "World Bank Economic Outlook", "CBO Economic Forecast", 
        "Fitch Ratings", "Moody's Analytics"
    ];

    const pool = isIndex ? (isKRW ? krAgencies : usAgencies) : (isKRW ? krFirms : usFirms);
    
    // Choose 4 firms deterministically
    const selectedFirms = [];
    const poolCopy = [...pool];
    
    for (let i = 0; i < 4; i++) {
        const index = (hash + i * 7) % poolCopy.length;
        selectedFirms.push(poolCopy.splice(index, 1)[0]);
    }

    // List of realistic rating combinations with offsets
    const profiles = [
        [
            { rating: isIndex ? "Bullish" : (isKRW ? "Strong Buy" : "Buy"), factor: 1.25 },
            { rating: isIndex ? "Bullish" : (isKRW ? "Buy" : "Overweight"), factor: 1.18 },
            { rating: isIndex ? "Neutral" : (isKRW ? "Buy" : "Outperform"), factor: 1.14 },
            { rating: isIndex ? "Neutral" : (isKRW ? "Hold" : "Neutral"), factor: 1.03 }
        ],
        [
            { rating: isIndex ? "Bullish" : (isKRW ? "Buy" : "Buy"), factor: 1.16 },
            { rating: isIndex ? "Bullish" : (isKRW ? "Strong Buy" : "Buy"), factor: 1.22 },
            { rating: isIndex ? "Neutral" : (isKRW ? "Hold" : "Neutral"), factor: 0.98 },
            { rating: isIndex ? "Bearish" : (isKRW ? "Reduce" : "Underweight"), factor: 0.88 }
        ],
        [
            { rating: isIndex ? "Bullish" : (isKRW ? "Buy" : "Overweight"), factor: 1.19 },
            { rating: isIndex ? "Neutral" : (isKRW ? "Hold" : "Neutral"), factor: 1.05 },
            { rating: isIndex ? "Neutral" : (isKRW ? "Buy" : "Buy"), factor: 1.12 },
            { rating: isIndex ? "Bullish" : (isKRW ? "Strong Buy" : "Buy"), factor: 1.27 }
        ],
        [
            { rating: isIndex ? "Neutral" : (isKRW ? "Hold" : "Neutral"), factor: 1.02 },
            { rating: isIndex ? "Bearish" : (isKRW ? "Reduce" : "Underweight"), factor: 0.91 },
            { rating: isIndex ? "Neutral" : (isKRW ? "Hold" : "Neutral"), factor: 1.04 },
            { rating: isIndex ? "Bullish" : (isKRW ? "Buy" : "Buy"), factor: 1.15 }
        ]
    ];

    const chosenProfile = profiles[hash % profiles.length];
    
    // Choose dates deterministically within the last 15 days
    const results = [];
    for (let i = 0; i < 4; i++) {
        const daysAgo = 2 + ((hash + i * 13) % 12); // between 2 and 14 days ago
        const dateObj = new Date();
        dateObj.setDate(dateObj.getDate() - daysAgo);
        const dateStr = dateObj.toISOString().split('T')[0];

        results.push({
            name: selectedFirms[i],
            rating: chosenProfile[i].rating,
            factor: chosenProfile[i].factor,
            date: dateStr
        });
    }

    // Sort by date descending
    results.sort((a, b) => b.date.localeCompare(a.date));
    return results;
}

window.openReportModal = function(ticker, companyName) {
    const modal = document.getElementById('report-modal');
    
    // Get current price from the DOM or state
    const config = indices[Object.keys(indices).find(key => indices[key].ticker === ticker)];
    const priceEl = document.getElementById(`${config.elementId}-price`);
    const currentPrice = priceEl ? parseFloat(priceEl.textContent.replace(/,/g, '')) : 70000;

    const report = generateDynamicReport(ticker, companyName);

    document.getElementById('report-stock-name').textContent = companyName;
    document.getElementById('report-stock-ticker').textContent = ticker;
    document.getElementById('report-summary').textContent = report.summary;
    
    const list = document.getElementById('recommendation-list');
    list.innerHTML = '';
    
    // Adapt dynamic firms and ratings depending on asset type
    const isIndex = ticker.startsWith('^') || ticker === 'KOSPI' || ticker === 'KOSDAQ' || ticker === 'NASDAQ' || ticker === 'S&P 500';
    const isKRW = ticker.endsWith('.KS') || ticker.endsWith('.KQ') || ticker === 'KOSPI' || ticker === 'KOSDAQ';
    
    const dynamicFirms = getDeterministicFirms(ticker, isIndex, isKRW);

    const currencyStr = isKRW ? 'KRW' : 'USD';

    // Update Table Headers dynamically for indices vs equities
    const headerRow = document.querySelector('.recommendation-table thead tr');
    if (headerRow) {
        if (isIndex) {
            headerRow.innerHTML = `
                <th>Research / Agency</th>
                <th>Market Outlook</th>
                <th>Target Range / Fair Value</th>
                <th>Date</th>
            `;
        } else {
            headerRow.innerHTML = `
                <th>Securities Firm</th>
                <th>Rating</th>
                <th>Target Price</th>
                <th>Date</th>
            `;
        }
    }

    dynamicFirms.forEach(f => {
        let targetPrice;
        if (isKRW) {
            targetPrice = Math.round((currentPrice * f.factor) / 100) * 100;
        } else {
            targetPrice = Math.round(currentPrice * f.factor * 100) / 100;
        }

        const pctDiff = ((targetPrice - currentPrice) / currentPrice) * 100;
        const pctDiffStr = `${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(1)}%`;
        const pctColor = pctDiff >= 0 ? 'var(--positive)' : 'var(--negative)';

        let ratingColor = 'var(--text-secondary)';
        if (f.rating.includes('Buy') || f.rating.includes('Bullish') || f.rating.includes('Overweight')) {
            ratingColor = 'var(--positive)';
        } else if (f.rating.includes('Sell') || f.rating.includes('Underweight')) {
            ratingColor = 'var(--negative)';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${f.name}</td>
            <td style="color: ${ratingColor}; font-weight: 500;">${f.rating}</td>
            <td style="font-weight: 600;">
                ${new Intl.NumberFormat('ko-KR').format(targetPrice)} ${currencyStr}
                <span style="color: ${pctColor}; font-size: 0.8rem; font-weight: 500; margin-left: 0.35rem;">(${pctDiffStr})</span>
            </td>
            <td>${f.date}</td>
        `;
        list.appendChild(tr);
    });

    const pointsList = document.getElementById('investment-points');
    pointsList.innerHTML = '';
    report.points.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p;
        pointsList.appendChild(li);
    });

    modal.classList.add('active');
};

function setupReportModalListeners() {
    const closeBtn = document.getElementById('report-modal-close-btn');
    const modal = document.getElementById('report-modal');
    
    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
    });
}

// ==========================================
// Google Login & Drive Sync Logic
// ==========================================

function setupLogin() {
    const loginBtn = document.getElementById('login-btn');
    const loginModal = document.getElementById('login-modal');
    const closeBtn = document.getElementById('login-modal-close-btn');
    const userProfile = document.getElementById('user-profile');
    const logoutBtn = document.getElementById('logout-btn');

    if (!loginBtn || !loginModal || !closeBtn || !userProfile || !logoutBtn) return;

    // Initialize Google Identity Services (retry if google is not yet defined)
    const initGIS = () => {
        if (typeof google !== 'undefined' && google.accounts) {
            try {
                googleTokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: DRIVE_SCOPE,
                    callback: (response) => {
                        if (response.error !== undefined) {
                            throw (response);
                        }
                        googleAccessToken = response.access_token;
                        localStorage.setItem('google_access_token', googleAccessToken);
                        localStorage.setItem('google_token_acquired_at', Date.now().toString());
                        handleSuccessfulLogin();
                    },
                });
                console.log('GIS initialized successfully');
                renderGoogleBtn(); // Render immediately if modal is open or for later
            } catch (err) {
                console.error('GIS initialization failed:', err);
            }
        } else {
            setTimeout(initGIS, 500); // Retry after 500ms
        }
    };

    initGIS();

    // Check for persisted login session on load
    const checkSavedLogin = async () => {
        const savedToken = localStorage.getItem('google_access_token');
        const acquiredAt = localStorage.getItem('google_token_acquired_at');
        // Valid for 50 minutes (3,000,000 ms)
        if (savedToken && acquiredAt && (Date.now() - parseInt(acquiredAt)) < 50 * 60 * 1000) {
            googleAccessToken = savedToken;
            console.log('Restoring persisted Google login session...');
            await handleSuccessfulLogin();
        }
    };
    checkSavedLogin();

    loginBtn.addEventListener('click', () => {
        loginModal.classList.add('active');
        renderGoogleBtn();
        updateDiagnosticInfo();
    });

    // Open login/diagnostic modal when clicking user profile avatar or name
    const avatar = document.querySelector('.user-avatar');
    const userName = document.querySelector('.user-name');
    const openDiagModal = () => {
        loginModal.classList.add('active');
        renderGoogleBtn();
        updateDiagnosticInfo();
    };
    if (avatar) {
        avatar.style.cursor = 'pointer';
        avatar.addEventListener('click', openDiagModal);
    }
    if (userName) {
        userName.style.cursor = 'pointer';
        userName.addEventListener('click', openDiagModal);
    }

    closeBtn.addEventListener('click', () => {
        loginModal.classList.remove('active');
    });

    loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) loginModal.classList.remove('active');
    });

    logoutBtn.addEventListener('click', () => {
        userProfile.style.display = 'none';
        loginBtn.style.display = 'flex';
        googleAccessToken = null;
        googleUserInfo = null; // Clear global state
        
        // Remove access token
        localStorage.removeItem('google_access_token');
        localStorage.removeItem('google_token_acquired_at');
        
        // Clear cached user data
        localStorage.removeItem('recent_searches');
        localStorage.removeItem('stock_portfolio');
        localStorage.removeItem('portfolio_snapshots');
        
        // Reset in-memory states
        recentSearches = [];
        portfolio = [];
        inMemorySnapshots = [];
        
        // Remove custom charts from DOM & indices
        document.querySelectorAll('.chart-card').forEach(card => {
            const key = card.getAttribute('data-key');
            if (key && key.startsWith('custom_')) {
                card.remove();
                if (charts[key]) {
                    charts[key].destroy();
                    delete charts[key];
                }
                delete indices[key];
            }
        });
        
        // Re-render portfolio panel (which will be empty)
        renderPortfolio();
        
        // Re-render snapshot list (which will show empty state)
        renderSnapshotList();
        
        console.log('User logged out and local state cleared');
    });

    // ☁️ Manual Save / Sync Button Listener
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            if (!googleAccessToken) {
                alert('로그인이 필요한 서비스입니다.');
                return;
            }
            
            syncBtn.textContent = '⏳ 저장 중...';
            syncBtn.style.background = 'rgba(245, 158, 11, 0.2)';
            syncBtn.style.borderColor = 'rgba(245, 158, 11, 0.4)';
            syncBtn.style.color = '#fbbf24';
            
            try {
                const success = await syncDataToGoogleDrive();
                if (success) {
                    syncBtn.textContent = '✅ 저장 완료!';
                    syncBtn.style.background = 'rgba(16, 185, 129, 0.2)';
                    syncBtn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                    syncBtn.style.color = '#34d399';
                } else {
                    syncBtn.textContent = '❌ 저장 실패';
                    syncBtn.style.background = 'rgba(239, 68, 68, 0.2)';
                    syncBtn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                    syncBtn.style.color = '#f87171';
                }
            } catch (err) {
                console.error(err);
                syncBtn.textContent = '❌ 저장 실패';
                syncBtn.style.background = 'rgba(239, 68, 68, 0.2)';
                syncBtn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                syncBtn.style.color = '#f87171';
            }
            
            setTimeout(() => {
                syncBtn.innerHTML = '☁️ 저장';
                syncBtn.style.background = 'rgba(59, 130, 246, 0.2)';
                syncBtn.style.borderColor = 'rgba(59, 130, 246, 0.4)';
                syncBtn.style.color = 'var(--neon-blue)';
            }, 2000);
        });
    }

    // 🔄 Manual Load Button Listener
    const loadBtn = document.getElementById('load-btn');
    if (loadBtn) {
        loadBtn.addEventListener('click', async () => {
            if (!googleAccessToken) {
                alert('로그인이 필요한 서비스입니다.');
                return;
            }
            
            loadBtn.textContent = '⏳ 불러오는 중...';
            loadBtn.style.background = 'rgba(245, 158, 11, 0.2)';
            loadBtn.style.borderColor = 'rgba(245, 158, 11, 0.4)';
            loadBtn.style.color = '#fbbf24';
            
            try {
                const success = await loadDataFromGoogleDrive();
                if (success) {
                    loadBtn.textContent = '✅ 불러오기 완료!';
                    loadBtn.style.background = 'rgba(16, 185, 129, 0.2)';
                    loadBtn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                    loadBtn.style.color = '#34d399';
                } else {
                    loadBtn.textContent = '❌ 불러오기 실패';
                    loadBtn.style.background = 'rgba(239, 68, 68, 0.2)';
                    loadBtn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                    loadBtn.style.color = '#f87171';
                }
            } catch (err) {
                console.error(err);
                loadBtn.textContent = '❌ 불러오기 실패';
                loadBtn.style.background = 'rgba(239, 68, 68, 0.2)';
                loadBtn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                loadBtn.style.color = '#f87171';
            }
            
            setTimeout(() => {
                loadBtn.innerHTML = '🔄 불러오기';
                loadBtn.style.background = 'rgba(139, 92, 246, 0.2)';
                loadBtn.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                loadBtn.style.color = 'var(--neon-purple)';
            }, 2000);
        });
    }
}

function updateDiagnosticInfo(driveStatus = '대기 중') {
    const loginStatusEl = document.getElementById('diag-login-status');
    const localPortfolioEl = document.getElementById('diag-local-portfolio');
    const localSearchesEl = document.getElementById('diag-local-searches');
    const driveStatusEl = document.getElementById('diag-drive-status');

    if (loginStatusEl) {
        if (googleAccessToken) {
            loginStatusEl.textContent = '로그인 완료';
            loginStatusEl.style.color = '#10b981';
        } else {
            loginStatusEl.textContent = '미로그인';
            loginStatusEl.style.color = '#ef4444';
        }
    }

    const localPortfolio = JSON.parse(localStorage.getItem('stock_portfolio')) || [];
    if (localPortfolioEl) {
        localPortfolioEl.textContent = `${localPortfolio.length}개 종목`;
    }

    const localSearches = JSON.parse(localStorage.getItem('recent_searches')) || [];
    if (localSearchesEl) {
        localSearchesEl.textContent = `${localSearches.length}개`;
    }

    if (driveStatusEl) {
        driveStatusEl.textContent = driveStatus;
        if (driveStatus.includes('성공') || driveStatus.includes('완료') || driveStatus.includes('성공(데이터 있음)')) {
            driveStatusEl.style.color = '#10b981';
        } else if (driveStatus.includes('실패') || driveStatus.includes('에러') || driveStatus.includes('실패:')) {
            driveStatusEl.style.color = '#ef4444';
        } else {
            driveStatusEl.style.color = 'var(--text-secondary)';
        }
    }
}

window.forceLocalRestore = async function() {
    await ensureKoreanStocks();
    const localPortfolio = JSON.parse(localStorage.getItem('stock_portfolio')) || [];
    const localSearches = JSON.parse(localStorage.getItem('recent_searches')) || [];
    const localSnapshots = JSON.parse(localStorage.getItem('portfolio_snapshots')) || [];

    if (localPortfolio.length > 0 || localSearches.length > 0 || localSnapshots.length > 0) {
        portfolio = localPortfolio.map(item => {
            const corrected = correctKoreanTicker(item.ticker);
            if (corrected !== item.ticker) {
                console.log(`Auto-correcting local portfolio ticker from ${item.ticker} to ${corrected}`);
                return {
                    ...item,
                    ticker: corrected,
                    key: `custom_${corrected.replace(/[^A-Z0-9]/g, '')}`
                };
            }
            return item;
        });

        recentSearches = localSearches.map(ticker => {
            const corrected = correctKoreanTicker(ticker);
            if (corrected !== ticker) {
                console.log(`Auto-correcting local search ticker from ${ticker} to ${corrected}`);
            }
            return corrected;
        });
        
        inMemorySnapshots = localSnapshots;
        
        updateDashboardPortfolioButtons();
        renderPortfolio();
        renderSnapshotList();
        
        // Stagger loading searches in background
        for (const ticker of recentSearches) {
            addChartProgrammatically(ticker);
        }
        
        updateDiagnosticInfo('로컬 복구 완료');
        alert('로컬 데이터 복구 완료!');
        
        // Close login modal
        const loginModal = document.getElementById('login-modal');
        if (loginModal) loginModal.classList.remove('active');
    } else {
        alert('복구할 로컬 데이터가 존재하지 않습니다.');
    }
};

    // ➕ Portfolio Add Ticker Button Listener
    const portfolioAddBtn = document.getElementById('portfolio-add-ticker-btn');
    if (portfolioAddBtn) {
        portfolioAddBtn.addEventListener('click', () => {
            const searchModal = document.getElementById('search-code-modal');
            const searchInput = document.getElementById('modal-search-input');
            const resultsContainer = document.getElementById('modal-search-results');
            if (searchModal && searchInput && resultsContainer) {
                searchModal.classList.add('active');
                searchInput.value = '';
                resultsContainer.innerHTML = `
                    <div style="text-align: center; color: #64748b; padding: 40px 10px; font-size: 0.9rem;">
                        포트폴리오에 추가할 종목명이나 심볼을 입력하고 검색 버튼을 누르세요.
                    </div>
                `;
                setTimeout(() => searchInput.focus(), 100);
            }
        });
    }

function renderGoogleBtn() {
    const btnContainer = document.getElementById('google-signin-btn');
    const headerTitle = document.querySelector('#login-modal .login-header h2');
    const headerDesc = document.querySelector('#login-modal .login-header p');
    const detailsEl = document.querySelector('#login-modal .diagnostic-section details');
    
    if (!btnContainer) return;
    
    if (googleAccessToken) {
        // Update header for logged in state
        if (headerTitle) headerTitle.textContent = '구글 계정 및 데이터 관리';
        if (headerDesc) headerDesc.textContent = '구글 드라이브와 연동하여 데이터를 동기화 중입니다.';
        
        // Auto-open diagnostic details block when logged in
        if (detailsEl) detailsEl.setAttribute('open', '');

        const userName = googleUserInfo?.name || 'Google User';
        const userEmail = googleUserInfo?.email || '';
        const userPicture = googleUserInfo?.picture || null;

        let avatarHtml = '';
        if (userPicture) {
            avatarHtml = `<img src="${userPicture}" referrerpolicy="no-referrer" style="width:100%; height:100%; border-radius:50%; object-fit:cover; display:block;">`;
        } else {
            avatarHtml = (userEmail || userName).substring(0, 2).toUpperCase();
        }

        btnContainer.innerHTML = `
            <div class="google-user-card" style="display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); padding: 12px; border-radius: 8px; margin-bottom: 10px; text-align: left;">
                <div class="user-avatar-modal" style="width: 40px; height: 40px; border-radius: 50%; background: var(--neon-blue); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; overflow: hidden; flex-shrink: 0;">
                    ${avatarHtml}
                </div>
                <div class="user-info-modal" style="display: flex; flex-direction: column; text-align: left; overflow: hidden; flex: 1;">
                    <span class="user-name-modal" style="font-weight: 600; color: #fff; font-size: 0.9rem;">${userName}</span>
                    <span class="user-email-modal" style="color: var(--text-secondary); font-size: 0.8rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${userEmail}</span>
                </div>
            </div>
            <button class="social-btn google-btn" onclick="requestGoogleAuth()" style="margin-top: 5px; background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: var(--text-secondary); font-size: 0.80rem; padding: 8px 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;">
                🔄 다른 계정으로 로그인 (Sign in with another account)
            </button>
        `;
    } else {
        // Reset header for guest state
        if (headerTitle) headerTitle.textContent = 'Welcome Back';
        if (headerDesc) headerDesc.textContent = 'Sync your portfolio with Google Drive';
        
        // Close details block by default for guest
        if (detailsEl) detailsEl.removeAttribute('open');

        if (googleTokenClient) {
            btnContainer.innerHTML = `
                <button class="social-btn google-btn" onclick="requestGoogleAuth()">
                    <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" width="20" height="20">
                    <span>Sign in with Google</span>
                </button>
            `;
        } else {
            btnContainer.innerHTML = `
                <button class="social-btn google-btn loading" disabled>
                    <span>Initializing Google Sign-In...</span>
                </button>
            `;
        }
    }
}

window.requestGoogleAuth = function() {
    if (googleTokenClient) {
        googleTokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        alert('Google API is still loading. Please try again in a moment.');
    }
};

async function handleSuccessfulLogin() {
    const loginBtn = document.getElementById('login-btn');
    const loginModal = document.getElementById('login-modal');
    const userProfile = document.getElementById('user-profile');
    const avatar = document.querySelector('.user-avatar');
    const userName = document.querySelector('.user-name');

    loginModal.classList.remove('active');
    loginBtn.style.display = 'none';
    userProfile.style.display = 'flex';

    let email = 'Google User';
    let displayName = 'Google User';
    let pictureUrl = null;

    if (googleAccessToken) {
        try {
            const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { 'Authorization': `Bearer ${googleAccessToken}` }
            });
            if (userInfoResponse.ok) {
                const userInfo = await userInfoResponse.json();
                email = userInfo.email || 'Google User';
                displayName = userInfo.name || email.split('@')[0];
                pictureUrl = userInfo.picture || null;
                googleUserInfo = { name: displayName, email: email, picture: pictureUrl };
            }
        } catch (e) {
            console.error('Failed to fetch Google UserInfo:', e);
        }
    }
    
    if (avatar) {
        if (pictureUrl) {
            avatar.innerHTML = `<img src="${pictureUrl}" referrerpolicy="no-referrer" style="width:100%; height:100%; border-radius:50%; object-fit:cover; display:block;">`;
        } else {
            avatar.textContent = email.substring(0, 2).toUpperCase();
        }
    }
    if (userName) userName.textContent = displayName;

    console.log('User logged in:', email);
    updateDiagnosticInfo();
    
    if (googleAccessToken) {
        loadDataFromGoogleDrive();
    }
}

async function findOrCreateDriveFile() {
    if (!googleAccessToken) return null;
    
    // 1. Search for the file in Google Drive
    const query = encodeURIComponent("name = 'stockpulse_data.json' and trashed = false");
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;
    
    const response = await fetch(listUrl, {
        headers: {
            'Authorization': `Bearer ${googleAccessToken}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Drive list failed: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    if (result.files && result.files.length > 0) {
        return result.files[0].id;
    }
    
    // 2. Create metadata-only file
    const metadata = {
        name: 'stockpulse_data.json',
        mimeType: 'application/json'
    };
    
    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${googleAccessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
    });
    
    if (!createResponse.ok) {
        throw new Error(`Drive create failed: ${createResponse.status} ${createResponse.statusText}`);
    }
    
    const createdFile = await createResponse.json();
    return createdFile.id;
}

async function saveToDriveFile(fileId, dataToSave) {
    const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
    
    const response = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${googleAccessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(dataToSave)
    });
    
    if (!response.ok) {
        throw new Error(`Drive save failed: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
}

async function readFromDriveFile(fileId) {
    const getUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    
    const response = await fetch(getUrl, {
        headers: {
            'Authorization': `Bearer ${googleAccessToken}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Drive read failed: ${response.status} ${response.statusText}`);
    }
    
    const text = await response.text();
    if (!text.trim()) {
        return null; // Empty file
    }
    
    return JSON.parse(text);
}

async function syncDataToGoogleDrive() {
    if (!googleAccessToken) return false;

    console.log('Syncing data directly to Google Drive...');
    
    // Construct recentSearches with prices
    const recentSearchesWithPrices = [];
    for (const ticker of recentSearches) {
        const indexKey = Object.keys(indices).find(k => indices[k].ticker === ticker);
        let price = 'N/A';
        if (indexKey) {
            const priceEl = document.getElementById(`${indexKey}-price`);
            if (priceEl) price = priceEl.textContent;
        }
        recentSearchesWithPrices.push({ ticker, price });
    }

    const dataToSave = {
        timestamp: new Date().toISOString(),
        recentSearches: recentSearches,
        recentSearchesWithPrices: recentSearchesWithPrices,
        portfolio: portfolio,
        snapshots: inMemorySnapshots
    };

    try {
        const fileId = await findOrCreateDriveFile();
        if (!fileId) throw new Error('Could not find or create sync file on Google Drive.');
        
        await saveToDriveFile(fileId, dataToSave);
        console.log('Sync successful. Saved to file ID:', fileId);
        return true;
    } catch (err) {
        console.error('Error syncing to Google Drive:', err);
        alert('구글 드라이브 저장 실패:\n' + err.message);
        return false;
    }
}

async function loadDataFromGoogleDrive() {
    if (!googleAccessToken) return false;

    console.log('Loading data directly from Google Drive...');
    updateDiagnosticInfo('⏳ 로드 중...');
    
    try {
        const fileId = await findOrCreateDriveFile();
        if (!fileId) throw new Error('Could not find or create sync file on Google Drive.');
        
        const data = await readFromDriveFile(fileId);
        console.log('Load successful, retrieved data:', data);
        
        if (data) {
            const hasDriveData = (data.portfolio && data.portfolio.length > 0) ||
                                 (data.recentSearches && data.recentSearches.length > 0);
            if (hasDriveData) {
                await restoreUserData(data);
                updateDiagnosticInfo('✅ 성공 (데이터 로드됨)');
            } else {
                console.log('No existing data found in file.');
                updateDiagnosticInfo('✅ 성공 (빈 파일)');
            }
        } else {
            console.log('Google Drive file is empty. Initializing new sync...');
            updateDiagnosticInfo('✅ 성공 (신규 빈 파일)');
        }
        return true;
    } catch (err) {
        console.error('Error loading from Google Drive:', err);
        updateDiagnosticInfo('❌ 에러: ' + err.message);
        alert('구글 드라이브 불러오기 실패:\n' + err.message);
        return false;
    }
}

async function restoreUserData(data) {
    console.log('Restoring loaded user data...', data);
    
    await ensureKoreanStocks();
    
    // 1. Restore Portfolio
    if (data.portfolio && Array.isArray(data.portfolio)) {
        portfolio = data.portfolio.map(item => {
            const corrected = correctKoreanTicker(item.ticker);
            if (corrected !== item.ticker) {
                console.log(`Auto-correcting portfolio ticker from ${item.ticker} to ${corrected}`);
                return {
                    ...item,
                    ticker: corrected,
                    key: `custom_${corrected.replace(/[^A-Z0-9]/g, '')}`
                };
            }
            return item;
        });
        updateDashboardPortfolioButtons();
        
        // Always render to ensure internal calculations and layouts update
        renderPortfolio();
    }
    
    // 2. Restore Recent Searches
    if (data.recentSearches && Array.isArray(data.recentSearches)) {
        // Clear existing custom charts from DOM & indices to prevent duplication
        document.querySelectorAll('.chart-card').forEach(card => {
            const key = card.getAttribute('data-key');
            if (key && key.startsWith('custom_')) {
                card.remove();
                if (charts[key]) {
                    charts[key].destroy();
                    delete charts[key];
                }
                delete indices[key];
            }
        });

        recentSearches = data.recentSearches.map(ticker => {
            const corrected = correctKoreanTicker(ticker);
            if (corrected !== ticker) {
                console.log(`Auto-correcting recent searches ticker from ${ticker} to ${corrected}`);
            }
            return corrected;
        });
        
        // Programmatically add loaded searches to the dashboard indices
        for (const ticker of recentSearches) {
            try {
                await addChartProgrammatically(ticker);
                await sleep(300); // stagger updates to prevent hitting rate limits
            } catch (err) {
                console.error(`Failed to load chart for ${ticker}:`, err);
            }
        }
    }

    // 3. Restore Snapshots
    if (data.snapshots && Array.isArray(data.snapshots)) {
        inMemorySnapshots = data.snapshots;
    } else {
        inMemorySnapshots = [];
    }
    renderSnapshotList();
}

async function addChartProgrammatically(ticker) {
    if (!ticker) return;
    
    // Check if already exists in indices
    if (Object.values(indices).some(idx => idx.ticker === ticker)) {
        return;
    }

    const key = `custom_${ticker.replace(/[^A-Z0-9]/g, '')}`;
    const randomColor = neonColors[Math.floor(Math.random() * neonColors.length)];

    // Register
    indices[key] = {
        name: ticker,
        ticker: ticker,
        color: randomColor.color,
        backgroundColor: randomColor.bg,
        elementId: key
    };

    // Create DOM element
    const container = document.querySelector('.dashboard-container');
    if (!container) return;

    const koreanTitle = getKoreanName(ticker, '');
    const showTicker = !ticker.startsWith('^');
    const displayTitle = showTicker ? `${koreanTitle} <span class="card-ticker">(${ticker})</span>` : koreanTitle;
    const cardHTML = `
        <div class="glass-card chart-card" data-key="${key}" draggable="true">
            <div class="card-header">
                <div class="header-left">
                    <h2>${displayTitle}</h2>
                    <span class="company-name" id="${key}-name">Loading...</span>
                </div>
                <div class="header-right">
                    <div class="price-container">
                        <span class="price" id="${key}-price">Loading...</span>
                        <span class="change" id="${key}-change">--</span>
                    </div>
                    <button class="remove-chart-btn" onclick="event.stopPropagation(); removeChart('${key}')" title="Remove Chart">&times;</button>
                </div>
            </div>
            <div class="chart-container">
                <canvas id="${key}-chart"></canvas>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', cardHTML);
    
    // Add click listener
    const newCard = container.lastElementChild;
    newCard.addEventListener('click', () => openModal(key));

    // Initialize chart
    await initSingleChart(key);
}

// ── Drag and Drop Stock Overlay Comparison ──
let comparisonChartInstance = null;

function setupDragAndDropListeners() {
    const container = document.querySelector('.dashboard-container');
    if (!container) return;

    // Set draggable true dynamically to all present chart cards
    document.querySelectorAll('.chart-card').forEach(card => {
        card.setAttribute('draggable', 'true');
    });

    container.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.chart-card');
        if (!card) return;
        
        e.dataTransfer.effectAllowed = 'all';
        e.dataTransfer.setData('text/plain', card.getAttribute('data-key'));
        card.classList.add('dragging');
    });

    container.addEventListener('dragend', (e) => {
        const card = e.target.closest('.chart-card');
        if (card) card.classList.remove('dragging');
        document.querySelectorAll('.chart-card').forEach(c => {
            c.classList.remove('drag-over', 'drag-insert-before', 'drag-insert-after');
        });
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const card = e.target.closest('.chart-card');
        const draggingCard = document.querySelector('.chart-card.dragging');
        if (card && card !== draggingCard) {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const ratio = x / rect.width;

            if (ratio < 0.2) {
                // Dragging to the left edge: insert before
                card.classList.remove('drag-over', 'drag-insert-after');
                card.classList.add('drag-insert-before');
                e.dataTransfer.dropEffect = 'move';
            } else if (ratio > 0.8) {
                // Dragging to the right edge: insert after
                card.classList.remove('drag-over', 'drag-insert-before');
                card.classList.add('drag-insert-after');
                e.dataTransfer.dropEffect = 'move';
            } else {
                // Center: Comparison Overlay
                card.classList.remove('drag-insert-before', 'drag-insert-after');
                card.classList.add('drag-over');
                e.dataTransfer.dropEffect = 'copy';
            }
        }
    });

    container.addEventListener('dragleave', (e) => {
        const card = e.target.closest('.chart-card');
        if (card) {
            card.classList.remove('drag-over', 'drag-insert-before', 'drag-insert-after');
        }
    });

    container.addEventListener('drop', async (e) => {
        e.preventDefault();
        const targetCard = e.target.closest('.chart-card');
        if (!targetCard) return;

        // Strip indicator classes immediately
        document.querySelectorAll('.chart-card').forEach(c => {
            c.classList.remove('drag-over', 'drag-insert-before', 'drag-insert-after');
        });

        const sourceKey = e.dataTransfer.getData('text/plain');
        const sourceCard = document.querySelector(`.chart-card[data-key="${sourceKey}"]`);
        
        if (!sourceKey || !sourceCard) return;

        const targetKey = targetCard.getAttribute('data-key');
        if (sourceKey === targetKey) return;

        // Calculate ratio at the exact drop coordinate to guarantee correct action regardless of async class updates
        const rect = targetCard.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const ratio = x / rect.width;

        if (ratio < 0.2) {
            // Drop on left edge: insert before
            targetCard.parentNode.insertBefore(sourceCard, targetCard);
            updateReorderedSearches();
        } else if (ratio > 0.8) {
            // Drop on right edge: insert after
            targetCard.parentNode.insertBefore(sourceCard, targetCard.nextSibling);
            updateReorderedSearches();
        } else {
            // Drop on center: trigger compare overlay modal
            openComparisonModal(sourceKey, targetKey);
        }
    });

    // Close comparison modal listeners
    const compModal = document.getElementById('comparison-modal');
    const compCloseBtn = document.getElementById('comparison-modal-close-btn');
    if (compModal && compCloseBtn) {
        compCloseBtn.addEventListener('click', () => compModal.classList.remove('active'));
        compModal.addEventListener('click', (e) => {
            if (e.target === compModal) compModal.classList.remove('active');
        });
    }

    // Stock comparison dropdown selection change listeners
    const select1 = document.getElementById('comp-stock1-select');
    const select2 = document.getElementById('comp-stock2-select');
    if (select1 && select2) {
        select1.addEventListener('change', () => {
            const val1 = select1.value;
            const val2 = select2.value;
            if (val1 === val2) {
                alert('비교할 두 종목은 서로 달라야 합니다.');
                select1.value = select1.dataset.prevVal;
                return;
            }
            select1.dataset.prevVal = val1;
            openComparisonModal(val1, val2);
        });
        select2.addEventListener('change', () => {
            const val1 = select1.value;
            const val2 = select2.value;
            if (val1 === val2) {
                alert('비교할 두 종목은 서로 달라야 합니다.');
                select2.value = select2.dataset.prevVal;
                return;
            }
            select2.dataset.prevVal = val2;
            openComparisonModal(val1, val2);
        });
    }
}

function updateReorderedSearches() {
    const container = document.querySelector('.dashboard-container');
    if (!container) return;

    // Get all present chart cards in current order
    const cards = container.querySelectorAll('.chart-card');
    const newSearches = [];
    
    cards.forEach(card => {
        const key = card.getAttribute('data-key');
        if (key && key.startsWith('custom_')) {
            const config = indices[key];
            if (config && config.ticker) {
                newSearches.push(config.ticker);
            }
        }
    });

    recentSearches = newSearches;
    console.log('Drag-to-reordered searches saved in memory:', recentSearches);
}

async function openComparisonModal(keyA, keyB) {
    const configA = indices[keyA];
    const configB = indices[keyB];
    if (!configA || !configB) return;

    const modal = document.getElementById('comparison-modal');
    if (!modal) return;

    // Populate dropdowns dynamically
    const select1 = document.getElementById('comp-stock1-select');
    const select2 = document.getElementById('comp-stock2-select');
    if (select1 && select2) {
        select1.innerHTML = '';
        select2.innerHTML = '';

        Object.keys(indices).forEach(key => {
            const config = indices[key];
            const name = getKoreanName(config.ticker, config.companyName || config.name);
            const text = `${name} (${config.ticker})`;

            const opt1 = document.createElement('option');
            opt1.value = key;
            opt1.textContent = text;
            select1.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = key;
            opt2.textContent = text;
            select2.appendChild(opt2);
        });

        select1.value = keyA;
        select2.value = keyB;

        select1.dataset.prevVal = keyA;
        select2.dataset.prevVal = keyB;
    }

    // Display title (Korean Translation)
    const displayTitleA = getKoreanName(configA.ticker, configA.companyName || configA.name);
    const displayTitleB = getKoreanName(configB.ticker, configB.companyName || configB.name);
    document.getElementById('comparison-title').textContent = `${displayTitleA} vs ${displayTitleB}`;

    // Get data for Stock A
    let dataA = [];
    if (charts[keyA] && charts[keyA].data.datasets[0].data.length > 0) {
        dataA = charts[keyA].data.datasets[0].data.map(d => ({
            x: d.x,
            y: d.y !== undefined ? d.y : d.c
        }));
    } else {
        const res = await fetchRealData(configA.ticker, currentRangeKey);
        if (res && res.data.length > 0) {
            dataA = res.data.map(d => ({ x: d.time.valueOf(), y: d.c }));
        }
    }

    // Get data for Stock B
    let dataB = [];
    if (charts[keyB] && charts[keyB].data.datasets[0].data.length > 0) {
        dataB = charts[keyB].data.datasets[0].data.map(d => ({
            x: d.x,
            y: d.y !== undefined ? d.y : d.c
        }));
    } else {
        const res = await fetchRealData(configB.ticker, currentRangeKey);
        if (res && res.data.length > 0) {
            dataB = res.data.map(d => ({ x: d.time.valueOf(), y: d.c }));
        }
    }

    if (dataA.length === 0 || dataB.length === 0) {
        alert('두 종목의 차트 데이터를 불러올 수 없습니다.');
        return;
    }

    // Normalize data to % growth from start point
    const startPriceA = dataA[0].y;
    const endPriceA = dataA[dataA.length - 1].y;
    const growthA = ((endPriceA - startPriceA) / startPriceA) * 100;

    const normalizedDataA = dataA.map(d => ({
        x: d.x,
        y: ((d.y - startPriceA) / startPriceA) * 100
    }));

    const startPriceB = dataB[0].y;
    const endPriceB = dataB[dataB.length - 1].y;
    const growthB = ((endPriceB - startPriceB) / startPriceB) * 100;

    const normalizedDataB = dataB.map(d => ({
        x: d.x,
        y: ((d.y - startPriceB) / startPriceB) * 100
    }));

    const isA_KRW = configA.ticker.endsWith('.KS') || configA.ticker.endsWith('.KQ') || configA.ticker === 'KOSPI' || configA.ticker === 'KOSDAQ';
    const isB_KRW = configB.ticker.endsWith('.KS') || configB.ticker.endsWith('.KQ') || configB.ticker === 'KOSPI' || configB.ticker === 'KOSDAQ';

    // Update Summary Box for Stock A (Dragged-in: Blue Color Coding, Korean Name)
    document.getElementById('comp-stock1-name').textContent = displayTitleA;
    const ticker1 = document.getElementById('comp-stock1-ticker');
    if (ticker1) {
        ticker1.textContent = configA.ticker;
        ticker1.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
        ticker1.style.color = '#3b82f6';
    }
    document.getElementById('comp-stock1-start-price').textContent = new Intl.NumberFormat('ko-KR').format(Math.round(startPriceA * 100) / 100) + (isA_KRW ? ' KRW' : ' USD');
    document.getElementById('comp-stock1-end-price').textContent = new Intl.NumberFormat('ko-KR').format(Math.round(endPriceA * 100) / 100) + (isA_KRW ? ' KRW' : ' USD');
    
    const box1 = document.getElementById('comp-stock1-box');
    if (box1) {
        box1.style.borderColor = 'rgba(59, 130, 246, 0.4)';
        box1.style.background = 'rgba(59, 130, 246, 0.03)';
    }

    const growthEl1 = document.getElementById('comp-stock1-growth');
    growthEl1.textContent = `${growthA >= 0 ? '+' : ''}${growthA.toFixed(2)}%`;
    growthEl1.style.color = growthA >= 0 ? 'var(--positive)' : 'var(--negative)';

    // Update Summary Box for Stock B (Base/Background: Red Color Coding, Korean Name)
    document.getElementById('comp-stock2-name').textContent = displayTitleB;
    const ticker2 = document.getElementById('comp-stock2-ticker');
    if (ticker2) {
        ticker2.textContent = configB.ticker;
        ticker2.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
        ticker2.style.color = '#ef4444';
    }
    document.getElementById('comp-stock2-start-price').textContent = new Intl.NumberFormat('ko-KR').format(Math.round(startPriceB * 100) / 100) + (isB_KRW ? ' KRW' : ' USD');
    document.getElementById('comp-stock2-end-price').textContent = new Intl.NumberFormat('ko-KR').format(Math.round(endPriceB * 100) / 100) + (isB_KRW ? ' KRW' : ' USD');
    
    const box2 = document.getElementById('comp-stock2-box');
    if (box2) {
        box2.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        box2.style.background = 'rgba(239, 68, 68, 0.03)';
    }

    const growthEl2 = document.getElementById('comp-stock2-growth');
    growthEl2.textContent = `${growthB >= 0 ? '+' : ''}${growthB.toFixed(2)}%`;
    growthEl2.style.color = growthB >= 0 ? 'var(--positive)' : 'var(--negative)';

    // Show Modal
    modal.classList.add('active');

    // Create Comparison Chart
    const compCanvas = document.getElementById('comparison-chart');
    if (!compCanvas) return;
    const ctx = compCanvas.getContext('2d');
    if (!ctx) return;
    if (comparisonChartInstance) {
        comparisonChartInstance.destroy();
    }

    comparisonChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: displayTitleA,
                    data: normalizedDataA,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2.5,
                    fill: false,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHitRadius: 10,
                    pointHoverRadius: 4
                },
                {
                    label: displayTitleB,
                    data: normalizedDataB,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2.5,
                    fill: false,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHitRadius: 10,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            ...commonChartOptions,
            plugins: {
                ...commonChartOptions.plugins,
                legend: {
                    display: true,
                    labels: {
                        color: '#f8fafc',
                        font: { family: "'Inter', sans-serif", size: 12 }
                    }
                },
                tooltip: {
                    ...commonChartOptions.plugins.tooltip,
                    callbacks: {
                        title: function(context) {
                            if (!context || !context.length) return '';
                            const rawTime = context[0].raw?.x;
                            if (rawTime) {
                                return new Date(rawTime).toLocaleDateString() + ' ' + new Date(rawTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false});
                            }
                            return context[0].label;
                        },
                        label: function(context) {
                            return `${context.dataset.label}: ${context.raw.y >= 0 ? '+' : ''}${context.raw.y.toFixed(2)}%`;
                        }
                    }
                }
            },
            scales: {
                ...commonChartOptions.scales,
                y: {
                    ...commonChartOptions.scales.y,
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 11 },
                        callback: function(value) {
                            return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
                        }
                    }
                }
            }
        }
    });
}

// ── Stock Code Search Feature ──

const ETF_DATABASE = {
    // 지수 추정형
    "069500.KS": { name: "KODEX 200", category: "INDEX", underlying: "코스피 200 지수", aum: 62000, ter: 0.15, dividend: 2.1, basePrice: 35000 },
    "379800.KS": { name: "KODEX 미국S&P500", category: "INDEX", underlying: "S&P 500 지수", aum: 18000, ter: 0.05, dividend: 1.3, basePrice: 15000 },
    "379810.KS": { name: "KODEX 미국나스닥100", category: "INDEX", underlying: "나스닥 100 지수", aum: 12000, ter: 0.05, dividend: 0.5, basePrice: 18000 },
    "122630.KS": { name: "KODEX 레버리지", category: "INDEX", underlying: "코스피 200 일일수익률 2배", aum: 21000, ter: 0.64, dividend: 0.0, basePrice: 16000 },
    "252670.KS": { name: "KODEX 200선물인버스2X", category: "INDEX", underlying: "코스피 200 선물지수 -2배", aum: 19000, ter: 0.64, dividend: 0.0, basePrice: 2000 },
    "360750.KS": { name: "TIGER 미국S&P500", category: "INDEX", underlying: "S&P 500 지수", aum: 45000, ter: 0.07, dividend: 1.4, basePrice: 17000 },
    "133690.KS": { name: "TIGER 미국나스닥100", category: "INDEX", underlying: "나스닥 100 지수", aum: 38000, ter: 0.07, dividend: 0.6, basePrice: 110000 },
    "233740.KS": { name: "KODEX 코스닥150선물레버리지", category: "INDEX", underlying: "코스닥 150 선물지수 2배", aum: 9500, ter: 0.64, dividend: 0.0, basePrice: 8000 },
    "251340.KS": { name: "KODEX 코스닥150인버스", category: "INDEX", underlying: "코스닥 150 지수 -1배", aum: 4200, ter: 0.64, dividend: 0.0, basePrice: 4000 },
    "495120.KS": { name: "KODEX 코리아밸류업", category: "INDEX", underlying: "코리아 밸류업 지수", aum: 2500, ter: 0.009, dividend: 2.2, basePrice: 10000 },

    // 섹터/테마형
    "395160.KS": { name: "KODEX AI반도체TOP2플러스", category: "THEME", underlying: "국내 AI 반도체 Top 2 및 주요 밸류체인", aum: 4800, ter: 0.39, dividend: 0.8, basePrice: 15000 },
    "292150.KS": { name: "TIGER 코리아TOP10", category: "THEME", underlying: "국내 시가총액 상위 10대 우량주", aum: 1800, ter: 0.15, dividend: 2.5, basePrice: 12000 },
    "445290.KS": { name: "KODEX 로봇액티브", category: "THEME", underlying: "글로벌 로봇산업 밸류체인", aum: 1200, ter: 0.50, dividend: 0.2, basePrice: 11000 },
    "487240.KS": { name: "KODEX AI전력핵심설비", category: "THEME", underlying: "국내 송배전 및 AI 전력인프라 핵심주", aum: 2500, ter: 0.39, dividend: 0.5, basePrice: 20000 },
    "0167Z0.KS": { name: "KODEX 미국우주항공", category: "THEME", underlying: "미국 우주항공 및 방산 혁신 기업", aum: 850, ter: 0.45, dividend: 0.0, basePrice: 10000 },
    "144600.KS": { name: "KODEX 은선물(H)", category: "THEME", underlying: "글로벌 은 현물가격 (환헤지)", aum: 2100, ter: 0.68, dividend: 0.0, basePrice: 6500 },
    "305720.KS": { name: "KODEX 2차전지산업", category: "THEME", underlying: "국내 2차전지 소재 및 셀 제조업체", aum: 11000, ter: 0.45, dividend: 0.4, basePrice: 18000 },
    "381000.KS": { name: "TIGER 미국필라델피아반도체나스닥", category: "THEME", underlying: "필라델피아 반도체 지수", aum: 23000, ter: 0.49, dividend: 1.1, basePrice: 22000 },
    "381170.KS": { name: "TIGER 미국테크TOP10 INDXX", category: "THEME", underlying: "미국 빅테크 상위 10대 기업", aum: 28000, ter: 0.49, dividend: 0.9, basePrice: 25000 },
    "371160.KS": { name: "TIGER 차이나전기차SOLACTIVE", category: "THEME", underlying: "중국 2차전지 및 전기차 밸류체인", aum: 15000, ter: 0.49, dividend: 0.0, basePrice: 8500 },
    "368590.KS": { name: "TIGER KRX금현물", category: "THEME", underlying: "KRX 금현물 지수", aum: 3200, ter: 0.19, dividend: 0.0, basePrice: 13500 },

    // 배당/인컴형
    "458730.KS": { name: "TIGER 미국배당다우존스", category: "INCOME", underlying: "Dow Jones US Dividend 100 지수", aum: 25000, ter: 0.05, dividend: 3.8, basePrice: 11000 },
    "479010.KS": { name: "KODEX 미국배당프리미엄다우존스액티브", category: "INCOME", underlying: "미국 배당성장 및 커버드콜 전략 (액티브)", aum: 4500, ter: 0.43, dividend: 7.2, basePrice: 10500 },
    "474940.KS": { name: "TIGER 미국배당+7%프리미엄다우존스", category: "INCOME", underlying: "미국 배당성장 및 커버드콜 옵션 매도 전략", aum: 9800, ter: 0.39, dividend: 10.2, basePrice: 10200 },
    "161510.KS": { name: "ARIRANG 고배당주", category: "INCOME", underlying: "국내 고배당 상위 30종목", aum: 2400, ter: 0.23, dividend: 6.1, basePrice: 13000 },
    "498400.KS": { name: "KODEX 200타겟위클리커버드콜", category: "INCOME", underlying: "코스피 200 지수 및 주간 옵션 매도", aum: 1500, ter: 0.25, dividend: 8.5, basePrice: 9500 },
    "458250.KS": { name: "TIGER 미국30년국채커버드콜active(H)", category: "INCOME", underlying: "미국 30년 국채 및 커버드콜 전략 (환헤지)", aum: 16000, ter: 0.25, dividend: 12.1, basePrice: 9200 },
    "459580.KS": { name: "KODEX CD금리액티브(합성)", category: "INCOME", underlying: "CD 91일물 금리", aum: 75000, ter: 0.02, dividend: 3.6, basePrice: 1030000 }
};

// --- ETF 스코어링 및 모의 데이터 생성 함수 시작 ---

function getDeterministicDiscrepancy(ticker) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const seedStr = ticker + dateStr;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
        hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const base = (Math.abs(hash) % 1000) / 1000;
    let maxDiscrepancy = 0.4;
    if (ticker === '0167Z0.KS') maxDiscrepancy = 0.8;
    
    let discVal = (base * 2 - 1) * maxDiscrepancy;
    return parseFloat(discVal.toFixed(2));
}

function generateMockHistory(ticker, rangeKey) {
    const safeTicker = String(ticker || 'UNKNOWN');
    const dbEntry = (typeof ETF_DATABASE !== 'undefined' && ETF_DATABASE) ? ETF_DATABASE[safeTicker] : null;
    let basePrice = 10000;
    if (dbEntry) {
        basePrice = dbEntry.basePrice;
    } else {
        // Deterministic base prices for major assets
        const lowerTicker = safeTicker.toLowerCase();
        if (lowerTicker === '^ks11' || lowerTicker === 'kospi') basePrice = 2550;
        else if (lowerTicker === '^kq11' || lowerTicker === 'kosdaq') basePrice = 760;
        else if (lowerTicker === '^ixic' || lowerTicker === 'nasdaq') basePrice = 16200;
        else if (lowerTicker === '^gspc' || lowerTicker === 's&p 500' || lowerTicker === 'sp500') basePrice = 5120;
        else if (lowerTicker.startsWith('005930')) basePrice = 75000; // 삼성전자
        else if (lowerTicker.startsWith('000660')) basePrice = 180000; // SK하이닉스
        else if (lowerTicker === 'aapl') basePrice = 175;
        else if (lowerTicker === 'nvda') basePrice = 850;
        else if (lowerTicker === 'tsla') basePrice = 170;
        else if (lowerTicker === 'msft') basePrice = 415;
        else {
            // Hash-based deterministic base price so it stays consistent for the same ticker
            let hashVal = 0;
            for (let i = 0; i < safeTicker.length; i++) {
                hashVal = safeTicker.charCodeAt(i) + ((hashVal << 5) - hashVal);
            }
            basePrice = 10 + (Math.abs(hashVal) % 490) * 10; // between 10 and 4900
            if (safeTicker.endsWith('.KS') || safeTicker.endsWith('.KQ')) {
                basePrice *= 100; // Korean stocks scaling
            }
        }
    }
    const name = dbEntry ? dbEntry.name : getKoreanName(safeTicker, safeTicker);
    
    let numPoints = 100;
    let intervalMs = 24 * 60 * 60 * 1000;
    if (rangeKey === '1h') {
        numPoints = 60;
        intervalMs = 60 * 1000;
    } else if (rangeKey === '1d') {
        numPoints = 78;
        intervalMs = 5 * 60 * 1000;
    } else if (rangeKey === '1w') {
        numPoints = 130;
        intervalMs = 15 * 60 * 1000;
    } else if (rangeKey === '1mo') {
        numPoints = 20;
        intervalMs = 24 * 60 * 60 * 1000;
    } else if (rangeKey === '6mo') {
        numPoints = 120;
        intervalMs = 24 * 60 * 60 * 1000;
    } else if (rangeKey === '1y') {
        numPoints = 240;
        intervalMs = 24 * 60 * 60 * 1000;
    } else if (rangeKey === '3y') {
        numPoints = 156;
        intervalMs = 7 * 24 * 60 * 60 * 1000;
    } else if (rangeKey === '5y') {
        numPoints = 60;
        intervalMs = 30 * 24 * 60 * 60 * 1000;
    }
    
    let hash = 0;
    for (let i = 0; i < safeTicker.length; i++) {
        hash = safeTicker.charCodeAt(i) + ((hash << 5) - hash);
    }
    let seed = Math.abs(hash);
    function pseudoRandom() {
        let x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    }
    
    let now = new Date();
    let data = [];
    let price = basePrice;
    
    for (let i = numPoints - 1; i >= 0; i--) {
        const time = new Date(now.getTime() - i * intervalMs);
        const pctChange = (pseudoRandom() - 0.485) * 0.015;
        const open = price;
        const close = price * (1 + pctChange);
        const high = Math.max(open, close) * (1 + pseudoRandom() * 0.005);
        const low = Math.min(open, close) * (1 - pseudoRandom() * 0.005);
        
        price = close;
        const baseVol = dbEntry ? dbEntry.aum * 10 : 50000;
        const v = Math.round(baseVol * (0.5 + pseudoRandom() * 1.5));
        
        data.push({
            time: time,
            o: open,
            h: high,
            l: low,
            c: close,
            price: close,
            v: v
        });
    }
    
    return {
        data: data,
        previousClose: data.length > 0 ? data[0].c : basePrice,
        companyName: name
    };
}

function calculateVolumeScore(avgVolume5, price, ticker) {
    const tradingValue = avgVolume5 * price;
    let score = 0;
    if (tradingValue >= 5000000000) {
        score = 100;
    } else if (tradingValue >= 1000000000) {
        score = 80 + ((tradingValue - 1000000000) / 4000000000) * 20;
    } else if (tradingValue >= 100000000) {
        score = 40 + ((tradingValue - 100000000) / 900000000) * 40;
    } else {
        score = (tradingValue / 100000000) * 40;
    }
    
    const discrepancy = Math.abs(getDeterministicDiscrepancy(ticker));
    if (discrepancy >= 0.5) {
        score = Math.max(0, score - 20);
    }
    return parseFloat(score.toFixed(1));
}

function calculateAUMScore(aumEok) {
    if (aumEok >= 100000) return 100;
    if (aumEok <= 100) return 0;
    const score = ((Math.log10(aumEok) - 2) / 3) * 100;
    return parseFloat(score.toFixed(1));
}

function calculateMomentumScore(historicalData, currentPrice) {
    const len = historicalData.length;
    if (len < 20) return 50;
    
    const pToday = currentPrice;
    const idx3m = Math.max(0, len - 1 - 60);
    const idx6m = Math.max(0, len - 1 - 120);
    
    const p3m = historicalData[idx3m].c;
    const p6m = historicalData[idx6m].c;
    
    const ret3m = (pToday / p3m) - 1;
    const ret6m = (pToday / p6m) - 1;
    
    let score3m = 50;
    if (ret3m >= 0.15) score3m = 100;
    else if (ret3m <= -0.15) score3m = 0;
    else score3m = 50 + (ret3m / 0.15) * 50;
    
    let score6m = 50;
    if (ret6m >= 0.25) score6m = 100;
    else if (ret6m <= -0.25) score6m = 0;
    else score6m = 50 + (ret6m / 0.25) * 50;
    
    const ma20 = getSMA(historicalData, 20);
    const ma60 = getSMA(historicalData, 60);
    const ma120 = getSMA(historicalData, 120);
    
    let maScore = 0;
    if (ma20 !== null && ma60 !== null && ma120 !== null) {
        if (ma20 > ma60 && ma60 > ma120) {
            maScore = 100;
        } else if (ma20 > ma60) {
            maScore = 50;
        }
    } else if (ma20 !== null && ma60 !== null) {
        if (ma20 > ma60) maScore = 70;
    } else {
        maScore = 50;
    }
    
    const totalMomentum = (score3m * 0.35) + (score6m * 0.35) + (maScore * 0.30);
    return parseFloat(totalMomentum.toFixed(1));
}

function calculateSupplyScore(ticker) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const seedStr = ticker + dateStr + "supply";
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
        hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const val = (Math.abs(hash) % 1000) / 1000;
    const netBuyRatio = -10 + val * 25;
    
    let score = 0;
    if (netBuyRatio >= 10) {
        score = 100;
    } else if (netBuyRatio >= 0) {
        score = 50 + (netBuyRatio / 10) * 50;
    } else {
        score = 50 + (netBuyRatio / 10) * 50;
    }
    return {
        ratio: parseFloat(netBuyRatio.toFixed(2)),
        score: parseFloat(score.toFixed(1))
    };
}

function calculateTERScore(ter, category) {
    let maxTer = 0.7;
    let minTer = 0.05;
    if (category === 'INDEX') {
        minTer = 0.05;
        maxTer = 0.64;
    } else if (category === 'THEME') {
        minTer = 0.15;
        maxTer = 0.70;
    } else if (category === 'INCOME') {
        minTer = 0.05;
        maxTer = 0.50;
    }
    
    if (ter <= minTer) return 100;
    if (ter >= maxTer) return 20;
    
    const score = 100 - ((ter - minTer) / (maxTer - minTer)) * 80;
    return parseFloat(score.toFixed(1));
}

function calculateDividendScore(dividendYield) {
    if (dividendYield >= 10.0) return 100;
    if (dividendYield <= 1.0) return 0;
    const score = ((dividendYield - 1.0) / 9.0) * 100;
    return parseFloat(score.toFixed(1));
}

function calculateETFScore(ticker, historical) {
    if (!ticker || typeof ETF_DATABASE === 'undefined') return null;
    const dbEntry = ETF_DATABASE[ticker];
    if (!dbEntry) return null;
    
    const data = historical ? historical.data : null;
    if (!data || data.length === 0) return null;
    const len = data.length;
    const latestPrice = data[len - 1].price;
    
    let volumeSum5 = 0;
    let days = 0;
    for (let j = len - 1; j >= Math.max(0, len - 5); j--) {
        volumeSum5 += data[j].v || 0;
        days++;
    }
    const avgVolume5 = days > 0 ? volumeSum5 / days : 100000;
    
    const volumeScore = calculateVolumeScore(avgVolume5, latestPrice, ticker);
    const aumScore = calculateAUMScore(dbEntry.aum);
    const momentumScore = calculateMomentumScore(data, latestPrice);
    const supplyData = calculateSupplyScore(ticker);
    const supplyScore = supplyData.score;
    const terScore = calculateTERScore(dbEntry.ter, dbEntry.category);
    const dividendScore = calculateDividendScore(dbEntry.dividend);
    
    let totalScore = 0;
    let weights = {};
    
    if (dbEntry.category === 'INDEX' || dbEntry.category === 'THEME') {
        weights = { volume: 0.25, aum: 0.15, momentum: 0.30, supply: 0.20, ter: 0.10 };
        totalScore = (volumeScore * 0.25) + (aumScore * 0.15) + (momentumScore * 0.30) + (supplyScore * 0.20) + (terScore * 0.10);
    } else if (dbEntry.category === 'INCOME') {
        weights = { volume: 0.25, aum: 0.15, momentum: 0.10, supply: 0.20, dividend: 0.30 };
        totalScore = (volumeScore * 0.25) + (aumScore * 0.15) + (momentumScore * 0.10) + (supplyScore * 0.20) + (dividendScore * 0.30);
    }
    
    totalScore = parseFloat(totalScore.toFixed(1));
    
    return {
        ticker: ticker,
        name: dbEntry.name,
        category: dbEntry.category,
        price: latestPrice,
        prevClose: historical.previousClose || latestPrice,
        totalScore: totalScore,
        scores: {
            volume: volumeScore,
            aum: aumScore,
            momentum: momentumScore,
            supply: supplyScore,
            ter: terScore,
            dividend: dividendScore
        },
        weights: weights,
        detail: {
            underlying: dbEntry.underlying,
            aum: dbEntry.aum,
            ter: dbEntry.ter,
            dividend: dbEntry.dividend,
            supplyRatio: supplyData.ratio,
            discrepancy: getDeterministicDiscrepancy(ticker),
            recommendations: getAnalystRecommendations(ticker, latestPrice)
        }
    };
}

function generateETFCommentary(res) {
    const { scores, totalScore, detail } = res;
    let text = `<strong>[고수 분석 요약]</strong><br>`;
    
    if (totalScore >= 80) {
        text += `• 본 ETF는 종합 점수 <strong>${totalScore}점</strong>으로 고수들의 스코어링 시스템 기준 최상위 등급에 해당합니다. `;
    } else if (totalScore >= 65) {
        text += `• 본 ETF는 종합 점수 <strong>${totalScore}점</strong>으로 안정적인 운용 구조 및 양호한 추세가 유지되는 투자 우수 등급입니다. `;
    } else {
        text += `• 본 ETF는 종합 점수 <strong>${totalScore}점</strong>으로 일부 요건은 만족하나 전반적인 지표 개선을 지켜볼 필요가 있는 대기 등급입니다. `;
    }
    
    const factorNames = {
        volume: '거래환금성',
        aum: '자산규모(AUM)',
        momentum: '상승모멘텀',
        supply: '기관/외인수급',
        ter: '비용효율성(TER)'
    };
    if (res.category === 'INCOME') factorNames.dividend = '인컴분배율';
    
    let maxKey = '', minKey = '';
    let maxScore = -1, minScore = 101;
    
    Object.keys(factorNames).forEach(key => {
        if (res.weights[key] === undefined) return;
        const s = scores[key];
        if (s > maxScore) { maxScore = s; maxKey = key; }
        if (s < minScore) { minScore = s; minKey = key; }
    });
    
    text += `특히 <strong>${factorNames[maxKey]}(${maxScore}점)</strong> 부문에서 가장 강한 면모를 보여주고 있으며, `;
    if (minScore <= 50) {
        text += `반면 <strong>${factorNames[minKey]}(${minScore}점)</strong> 부분은 상대적 보완이 필요한 지표로 분석됩니다.<br><br>`;
    } else {
        text += `전반적인 5대 핵심 지표가 균형 잡혀 있습니다.<br><br>`;
    }
    
    text += `<strong>[시장 효율성 및 수급 상태]</strong><br>`;
    const absDisc = Math.abs(detail.discrepancy);
    if (absDisc >= 0.5) {
        text += `⚠️ 현재 괴리율이 <strong>${detail.discrepancy}%</strong>로 다소 크게 나타나고 있어 순자산가치(NAV) 대비 시장 가격이 왜곡되어 있을 위험이 있으니 매매 시 지정가 주문 활용 등 각별한 주의가 요망됩니다. `;
    } else {
        text += `• 현재 순자산가치(NAV) 대비 시장 가격 괴리율은 <strong>${detail.discrepancy}%</strong>로 매우 안정적인 범위를 유지하고 있습니다. `;
    }
    
    if (detail.supplyRatio >= 5) {
        text += `또한 최근 기관/외인의 순매수 강도(거래량 대비 <strong>+${detail.supplyRatio}%</strong>)가 뚜렷하여 수급 뒷받침이 탄탄합니다.`;
    } else if (detail.supplyRatio <= -3) {
        text += `다만 기관/외인이 거래대금 대비 약 <strong>${detail.supplyRatio}%</strong>의 순매도 우위를 보이고 있어 수급상 단기 저항을 받을 수 있으니 분할 매수로 대응하는 편이 좋습니다.`;
    } else {
        text += `기관/외인의 수급은 <strong>${detail.supplyRatio}%</strong> 수준으로 특이 동향 없이 균형을 이루고 있습니다.`;
    }
    
    return text;
}

function renderETFDetailReport(res) {
    document.getElementById('etf-detail-underlying').textContent = res.detail.underlying;
    
    let aumText = '';
    if (res.detail.aum >= 10000) {
        const jo = Math.floor(res.detail.aum / 10000);
        const eok = res.detail.aum % 10000;
        aumText = `${jo}조 ${eok > 0 ? new Intl.NumberFormat('ko-KR').format(eok) : ''}억 원`;
    } else {
        aumText = `${new Intl.NumberFormat('ko-KR').format(res.detail.aum)}억 원`;
    }
    document.getElementById('etf-detail-aum').textContent = aumText;
    document.getElementById('etf-detail-ter').textContent = `${res.detail.ter.toFixed(2)}%`;
    document.getElementById('etf-detail-dividend').textContent = `${res.detail.dividend.toFixed(1)}%`;
    
    const container = document.getElementById('etf-factor-scores-container');
    if (container) {
        container.innerHTML = '';
        let factorLabels = {};
        if (res.category === 'INCOME') {
            factorLabels = {
                volume: { name: '거래대금 & 환금성', color: 'var(--neon-blue)' },
                aum: { name: '자산 규모 (AUM)', color: 'var(--neon-purple)' },
                momentum: { name: '모멘텀 & 상승 추세', color: 'var(--neon-pink)' },
                supply: { name: '수급 (기관/외인)', color: '#f59e0b' },
                dividend: { name: '배당/인컴 분배율', color: '#10b981' }
            };
        } else {
            factorLabels = {
                volume: { name: '거래대금 & 환금성', color: 'var(--neon-blue)' },
                aum: { name: '자산 규모 (AUM)', color: 'var(--neon-purple)' },
                momentum: { name: '모멘텀 & 상승 추세', color: 'var(--neon-pink)' },
                supply: { name: '수급 (기관/외인)', color: '#f59e0b' },
                ter: { name: '비용 효율성 (TER)', color: 'var(--positive)' }
            };
        }
        
        Object.keys(factorLabels).forEach(key => {
            const score = res.scores[key];
            const weight = (res.weights[key] * 100).toFixed(0);
            const fl = factorLabels[key];
            
            const barHtml = `
                <div class="factor-row" style="display: flex; flex-direction: column; gap: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                        <span style="color: #cbd5e1; font-weight: 600;">${fl.name} <span style="font-size: 0.75rem; color: var(--text-secondary);">(가중치 ${weight}%)</span></span>
                        <span style="color: ${fl.color}; font-weight: 700;">${score}점</span>
                    </div>
                    <div style="background: rgba(255, 255, 255, 0.05); height: 8px; border-radius: 99px; overflow: hidden; border: 1px solid rgba(255,255,255,0.03);">
                        <div style="background: ${fl.color}; width: ${score}%; height: 100%; border-radius: 99px; transition: width 0.5s ease-out;"></div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', barHtml);
        });
    }
    
    // Dynamic weights explanation badges on the explanation card
    const badgeWeight3 = document.getElementById('etf-badge-weight-3');
    const badgeWeight5 = document.getElementById('etf-badge-weight-5');
    if (badgeWeight3 && badgeWeight5) {
        if (res.category === 'INCOME') {
            badgeWeight3.textContent = '10%';
            badgeWeight5.textContent = '30%';
        } else {
            badgeWeight3.textContent = '30%';
            badgeWeight5.textContent = '10%';
        }
    }
    
    const commBox = document.getElementById('etf-detail-commentary-box');
    if (commBox) {
        commBox.innerHTML = generateETFCommentary(res);
    }
    
    // Render ETF recommendations
    const recTbody = document.getElementById('etf-analyst-rec-tbody');
    const recEmptyEl = document.getElementById('etf-analyst-rec-empty');
    const recTable = recTbody ? recTbody.closest('table') : null;

    if (recTbody && recEmptyEl && recTable) {
        recTbody.innerHTML = '';
        if (res.detail.recommendations && res.detail.recommendations.length > 0) {
            recEmptyEl.style.display = 'none';
            recTable.style.display = 'table';
            
            const isKRW = res.ticker.endsWith('.KS') || res.ticker.endsWith('.KQ');
            const currencyUnit = isKRW ? ' KRW' : ' USD';
            const formatNum = (val) => new Intl.NumberFormat('ko-KR').format(Math.round(val * 100) / 100) + currencyUnit;

            res.detail.recommendations.forEach(rec => {
                const currentPrice = res.price;
                const upsidePct = ((rec.targetPrice - currentPrice) / currentPrice) * 100;
                const upsideSign = upsidePct >= 0 ? '+' : '';
                const upsideColor = upsidePct > 0 ? 'var(--positive)' : (upsidePct < 0 ? 'var(--negative)' : '#fff');
                
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                tr.innerHTML = `
                    <td style="padding: 0.75rem 1rem; color: #fff; font-weight: 500; white-space: nowrap;">${rec.firm}</td>
                    <td style="padding: 0.75rem 1rem; color: #cbd5e1; white-space: nowrap;">${rec.opinion}</td>
                    <td style="padding: 0.75rem 1rem; color: #fff; text-align: right; font-family: monospace; white-space: nowrap;">${formatNum(rec.targetPrice)}</td>
                    <td style="padding: 0.75rem 1rem; color: ${upsideColor}; text-align: right; font-weight: 600; font-family: monospace; white-space: nowrap;">${upsideSign}${upsidePct.toFixed(1)}%</td>
                    <td style="padding: 0.75rem 1rem; color: var(--text-secondary); text-align: center; font-size: 0.8rem; white-space: nowrap;">${rec.date}</td>
                `;
                recTbody.appendChild(tr);
            });
        } else {
            recEmptyEl.style.display = 'block';
            recTable.style.display = 'none';
        }
    }
}

// --- ETF 스코어링 및 모의 데이터 생성 함수 끝 ---

const POPULAR_STOCKS = [
    // 한국 코스피 / 코스닥 인기 종목
    { symbol: "005930.KS", name: "삼성전자", engName: "Samsung Electronics", exchange: "KOSPI" },
    { symbol: "000660.KS", name: "SK하이닉스", engName: "SK hynix", exchange: "KOSPI" },
    { symbol: "373220.KS", name: "LG에너지솔루션", engName: "LG Energy Solution", exchange: "KOSPI" },
    { symbol: "207940.KS", name: "삼성바이오로직스", engName: "Samsung Biologics", exchange: "KOSPI" },
    { symbol: "005380.KS", name: "현대차", engName: "Hyundai Motor", exchange: "KOSPI" },
    { symbol: "000270.KS", name: "기아", engName: "Kia", exchange: "KOSPI" },
    { symbol: "068270.KS", name: "셀트리온", engName: "Celltrion", exchange: "KOSPI" },
    { symbol: "005490.KS", name: "POSCO홀딩스", engName: "POSCO Holdings", exchange: "KOSPI" },
    { symbol: "035420.KS", name: "NAVER", engName: "Naver", exchange: "KOSPI" },
    { symbol: "035720.KS", name: "카카오", engName: "Kakao", exchange: "KOSPI" },
    { symbol: "009150.KS", name: "삼성전기", engName: "Samsung Electro-Mechanics", exchange: "KOSPI" },
    { symbol: "010140.KS", name: "삼성중공업", engName: "Samsung Heavy Industries", exchange: "KOSPI" },
    { symbol: "006400.KS", name: "삼성SDI", engName: "Samsung SDI", exchange: "KOSPI" },
    { symbol: "051910.KS", name: "LG화학", engName: "LG Chem", exchange: "KOSPI" },
    { symbol: "055560.KS", name: "KB금융", engName: "KB Financial Group", exchange: "KOSPI" },
    { symbol: "055550.KS", name: "신한지주", engName: "Shinhan Financial Group", exchange: "KOSPI" },
    { symbol: "028260.KS", name: "삼성물산", engName: "Samsung C&T", exchange: "KOSPI" },
    { symbol: "247540.KQ", name: "에코프로비엠", engName: "EcoPro BM", exchange: "KOSDAQ" },
    { symbol: "086520.KQ", name: "에코프로", engName: "EcoPro", exchange: "KOSDAQ" },
    { symbol: "028300.KQ", name: "HLB", engName: "HLB", exchange: "KOSDAQ" },
    { symbol: "196170.KQ", name: "알테오젠", engName: "Alteogen", exchange: "KOSDAQ" },
    { symbol: "068760.KQ", name: "셀트리온제약", engName: "Celltrion Pharm", exchange: "KOSDAQ" },
    { symbol: "403870.KQ", name: "HPSP", engName: "HPSP", exchange: "KOSDAQ" },
    { symbol: "348370.KQ", name: "엔켐", engName: "Enchem", exchange: "KOSDAQ" },
    { symbol: "058470.KQ", name: "리노공업", engName: "Leeno Industrial", exchange: "KOSDAQ" },
    { symbol: "277810.KQ", name: "레인보우로보틱스", engName: "Rainbow Robotics", exchange: "KOSDAQ" },
    { symbol: "075300.KQ", name: "신성델타테크", engName: "Shinsung Delta Tech", exchange: "KOSDAQ" },
    { symbol: "034020.KS", name: "두산에너빌리티", engName: "Doosan Enerbility", exchange: "KOSPI" },
    { symbol: "323410.KS", name: "카카오뱅크", engName: "Kakao Bank", exchange: "KOSPI" },
    { symbol: "377300.KS", name: "카카오페이", engName: "Kakao Pay", exchange: "KOSPI" },
    { symbol: "096770.KS", name: "SK이노베이션", engName: "SK Innovation", exchange: "KOSPI" },
    { symbol: "015760.KS", name: "한국전력", engName: "Korea Electric Power", exchange: "KOSPI" },
    { symbol: "003490.KS", name: "대한항공", engName: "Korean Air", exchange: "KOSPI" },
    { symbol: "011200.KS", name: "HMM", engName: "HMM", exchange: "KOSPI" },
    { symbol: "003670.KS", name: "포스코퓨처엠", engName: "POSCO FUTURE M", exchange: "KOSPI" },
    { symbol: "259960.KS", name: "크래프톤", engName: "Krafton", exchange: "KOSPI" },
    { symbol: "251270.KS", name: "넷마블", engName: "Netmarble", exchange: "KOSPI" },
    { symbol: "036570.KS", name: "엔씨소프트", engName: "NCSoft", exchange: "KOSPI" },
    { symbol: "352820.KS", name: "하이브", engName: "HYBE", exchange: "KOSPI" },
    { symbol: "000100.KS", name: "유한양행", engName: "Yuhan", exchange: "KOSPI" },
    { symbol: "042660.KS", name: "한화오션", engName: "Hanwha Ocean", exchange: "KOSPI" },
    { symbol: "454910.KS", name: "두산로보틱스", engName: "Doosan Robotics", exchange: "KOSPI" },
    { symbol: "450080.KS", name: "에코프로머티", engName: "EcoPro Materials", exchange: "KOSPI" },
    { symbol: "009830.KS", name: "한화솔루션", engName: "Hanwha Solutions", exchange: "KOSPI" },
    { symbol: "066570.KS", name: "LG전자", engName: "LG Electronics", exchange: "KOSPI" },
    { symbol: "034220.KS", name: "LG디스플레이", engName: "LG Display", exchange: "KOSPI" },
    { symbol: "012330.KS", name: "현대모비스", engName: "Hyundai Mobis", exchange: "KOSPI" },
    { symbol: "033780.KS", name: "KT&G", engName: "KT&G", exchange: "KOSPI" },
    { symbol: "017670.KS", name: "SK텔레콤", engName: "SK Telecom", exchange: "KOSPI" },
    { symbol: "030200.KS", name: "KT", engName: "KT", exchange: "KOSPI" },
    { symbol: "032640.KS", name: "LG유플러스", engName: "LG Uplus", exchange: "KOSPI" },

    // 미국 인기 종목
    { symbol: "AAPL", name: "애플", engName: "Apple Inc.", exchange: "NASDAQ" },
    { symbol: "MSFT", name: "마이크로소프트", engName: "Microsoft Corp.", exchange: "NASDAQ" },
    { symbol: "NVDA", name: "엔비디아", engName: "NVIDIA Corp.", exchange: "NASDAQ" },
    { symbol: "GOOGL", name: "구글 / 알파벳 A", engName: "Alphabet Inc. Class A", exchange: "NASDAQ" },
    { symbol: "GOOG", name: "구글 / 알파벳 C", engName: "Alphabet Inc. Class C", exchange: "NASDAQ" },
    { symbol: "AMZN", name: "아마존", engName: "Amazon.com Inc.", exchange: "NASDAQ" },
    { symbol: "META", name: "메타 / 페이스북", engName: "Meta Platforms Inc.", exchange: "NASDAQ" },
    { symbol: "TSLA", name: "테슬라", engName: "Tesla Inc.", exchange: "NASDAQ" },
    { symbol: "BRK-B", name: "버크셔 해서웨이", engName: "Berkshire Hathaway Inc.", exchange: "NYSE" },
    { symbol: "LLY", name: "일라이 릴리", engName: "Eli Lilly and Company", exchange: "NYSE" },
    { symbol: "AVGO", name: "브로드컴", engName: "Broadcom Inc.", exchange: "NASDAQ" },
    { symbol: "JPM", name: "JP모건 체이스", engName: "JPMorgan Chase & Co.", exchange: "NYSE" },
    { symbol: "AMD", name: "AMD", engName: "Advanced Micro Devices", exchange: "NASDAQ" },
    { symbol: "INTC", name: "인텔", engName: "Intel Corp.", exchange: "NASDAQ" },
    { symbol: "NFLX", name: "넷플릭스", engName: "Netflix Inc.", exchange: "NASDAQ" },
    { symbol: "ADBE", name: "어도비", engName: "Adobe Inc.", exchange: "NASDAQ" },
    { symbol: "CRM", name: "세일즈포스", engName: "Salesforce Inc.", exchange: "NYSE" },
    { symbol: "ASML", name: "ASML", engName: "ASML Holding N.V.", exchange: "NASDAQ" },
    { symbol: "TSM", name: "TSMC", engName: "Taiwan Semiconductor Manufacturing", exchange: "NYSE" },
    { symbol: "QCOM", name: "퀄컴", engName: "Qualcomm Inc.", exchange: "NASDAQ" },
    { symbol: "MU", name: "마이크론 테크놀로지", engName: "Micron Technology", exchange: "NASDAQ" },
    { symbol: "ARM", name: "ARM", engName: "Arm Holdings plc", exchange: "NASDAQ" },
    { symbol: "PLTR", name: "팔란티어", engName: "Palantir Technologies", exchange: "NYSE" },
    { symbol: "SMCI", name: "슈퍼 마이크로 컴퓨터", engName: "Super Micro Computer", exchange: "NASDAQ" },
    { symbol: "COIN", name: "코인베이스", engName: "Coinbase Global", exchange: "NASDAQ" },
    { symbol: "XOM", name: "엑슨모빌", engName: "Exxon Mobil Corp.", exchange: "NYSE" },
    { symbol: "CVX", name: "쉐브론", engName: "Chevron Corp.", exchange: "NYSE" },
    { symbol: "KO", name: "코카콜라", engName: "The Coca-Cola Co.", exchange: "NYSE" },
    { symbol: "PEP", name: "펩시코", engName: "PepsiCo Inc.", exchange: "NASDAQ" },
    { symbol: "COST", name: "코스트코", engName: "Costco Wholesale", exchange: "NASDAQ" },
    { symbol: "WMT", name: "월마트", engName: "Walmart Inc.", exchange: "NYSE" },
    { symbol: "NKE", name: "나이키", engName: "Nike Inc.", exchange: "NYSE" },
    { symbol: "DIS", name: "디즈니", engName: "The Walt Disney Co.", exchange: "NYSE" },
    { symbol: "MCD", name: "맥도날드", engName: "McDonald's Corp.", exchange: "NYSE" },
    { symbol: "SBUX", name: "스타벅스", engName: "Starbucks Corp.", exchange: "NASDAQ" },
    { symbol: "BA", name: "보잉", engName: "The Boeing Co.", exchange: "NYSE" },
    { symbol: "PFE", name: "화이자", engName: "Pfizer Inc.", exchange: "NYSE" },
    { symbol: "MRNA", name: "모더나", engName: "Moderna Inc.", exchange: "NASDAQ" },
    
    // ETF 종목들
    { symbol: "069500.KS", name: "KODEX 200", engName: "KODEX 200 ETF", exchange: "KOSPI" },
    { symbol: "379800.KS", name: "KODEX 미국S&P500", engName: "KODEX US S&P500 ETF", exchange: "KOSPI" },
    { symbol: "379810.KS", name: "KODEX 미국나스닥100", engName: "KODEX US Nasdaq 100 ETF", exchange: "KOSPI" },
    { symbol: "122630.KS", name: "KODEX 레버리지", engName: "KODEX Leverage ETF", exchange: "KOSPI" },
    { symbol: "252670.KS", name: "KODEX 200선물인버스2X", engName: "KODEX 200 Futures Inverse 2X ETF", exchange: "KOSPI" },
    { symbol: "360750.KS", name: "TIGER 미국S&P500", engName: "TIGER US S&P500 ETF", exchange: "KOSPI" },
    { symbol: "133690.KS", name: "TIGER 미국나스닥100", engName: "TIGER US Nasdaq 100 ETF", exchange: "KOSPI" },
    { symbol: "233740.KS", name: "KODEX 코스닥150선물레버리지", engName: "KODEX Kosdaq 150 Futures Leverage ETF", exchange: "KOSPI" },
    { symbol: "251340.KS", name: "KODEX 코스닥150인버스", engName: "KODEX Kosdaq 150 Inverse ETF", exchange: "KOSPI" },
    { symbol: "395160.KS", name: "KODEX AI반도체TOP2플러스", engName: "KODEX AI Semiconductor TOP2 Plus ETF", exchange: "KOSPI" },
    { symbol: "292150.KS", name: "TIGER 코리아TOP10", engName: "TIGER Korea TOP10 ETF", exchange: "KOSPI" },
    { symbol: "445290.KS", name: "KODEX 로봇액티브", engName: "KODEX Robot Active ETF", exchange: "KOSPI" },
    { symbol: "487240.KS", name: "KODEX AI전력핵심설비", engName: "KODEX AI Power Infrastructure ETF", exchange: "KOSPI" },
    { symbol: "0167Z0.KS", name: "KODEX 미국우주항공", engName: "KODEX US Aerospace ETF", exchange: "KOSPI" },
    { symbol: "144600.KS", name: "KODEX 은선물(H)", engName: "KODEX Silver Futures ETF H", exchange: "KOSPI" },
    { symbol: "305720.KS", name: "KODEX 2차전지산업", engName: "KODEX Secondary Battery Industry ETF", exchange: "KOSPI" },
    { symbol: "381000.KS", name: "TIGER 미국필라델피아반도체나스닥", engName: "TIGER US PHLX Semiconductor ETF", exchange: "KOSPI" },
    { symbol: "381170.KS", name: "TIGER 미국테크TOP10 INDXX", engName: "TIGER US Tech TOP10 ETF", exchange: "KOSPI" },
    { symbol: "371160.KS", name: "TIGER 차이나전기차SOLACTIVE", engName: "TIGER China Electric Vehicle ETF", exchange: "KOSPI" },
    { symbol: "458730.KS", name: "TIGER 미국배당다우존스", engName: "TIGER US Dividend Dow Jones ETF", exchange: "KOSPI" },
    { symbol: "479010.KS", name: "KODEX 미국배당프리미엄다우존스액티브", engName: "KODEX US Dividend Premium Dow Jones Active ETF", exchange: "KOSPI" },
    { symbol: "474940.KS", name: "TIGER 미국배당+7%프리미엄다우존스", engName: "TIGER US Dividend +7% Premium ETF", exchange: "KOSPI" },
    { symbol: "161510.KS", name: "ARIRANG 고배당주", engName: "ARIRANG High Dividend ETF", exchange: "KOSPI" },
    { symbol: "498400.KS", name: "KODEX 200타겟위클리커버드콜", engName: "KODEX 200 Target Weekly Covered Call ETF", exchange: "KOSPI" },
    { symbol: "458250.KS", name: "TIGER 미국30년국채커버드콜active(H)", engName: "TIGER US 30Y Treasury Covered Call Active ETF H", exchange: "KOSPI" },
    { symbol: "368590.KS", name: "TIGER KRX금현물", engName: "TIGER KRX Gold Spot ETF", exchange: "KOSPI" },
    { symbol: "459580.KS", name: "KODEX CD금리액티브(합성)", engName: "KODEX CD Interest Rate Active ETF", exchange: "KOSPI" },
    { symbol: "495120.KS", name: "KODEX 코리아밸류업", engName: "KODEX Korea Value-Up ETF", exchange: "KOSPI" }
];

async function searchYahooFinanceTicker(query) {
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=15&newsCount=0`;
    
    for (const proxyFn of CORS_PROXIES) {
        const proxyUrl = proxyFn(searchUrl);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data && data.quotes) return data.quotes;
        } catch (e) {
            console.warn(`Proxy failed for search:`, e.message);
        }
    }
    return [];
}

function setupSearchCodeModalListeners() {
    const searchBtn = document.getElementById('search-code-btn');
    const modal = document.getElementById('search-code-modal');
    const closeBtn = document.getElementById('search-code-modal-close-btn');
    const searchInput = document.getElementById('modal-search-input');
    const submitBtn = document.getElementById('modal-search-submit-btn');
    const resultsContainer = document.getElementById('modal-search-results');

    if (!searchBtn || !modal || !closeBtn || !searchInput || !submitBtn || !resultsContainer) return;

    searchBtn.addEventListener('click', () => {
        modal.classList.add('active');
        searchInput.value = '';
        resultsContainer.innerHTML = `
            <div style="text-align: center; color: #64748b; padding: 40px 10px; font-size: 0.9rem;">
                종목명이나 심볼을 입력하고 검색 버튼을 누르세요.
            </div>
        `;
        setTimeout(() => searchInput.focus(), 100);
    });

    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
            alert('검색어를 입력해 주세요.');
            return;
        }

        resultsContainer.innerHTML = `
            <div style="text-align: center; color: #f8fafc; padding: 40px 10px; font-size: 0.9rem;">
                <span class="loading-spinner" style="display: inline-block; width: 1.5rem; height: 1.5rem; border: 2px solid rgba(255,255,255,0.1); border-radius: 50%; border-top-color: var(--neon-blue); animation: spin 1s linear infinite; margin-bottom: 8px;"></span>
                <br>종목 검색 중...
            </div>
        `;

        // Load local full stock database if not loaded
        if (!cachedKoreanStocks) {
            try {
                const response = await fetch('korean_stocks.json');
                if (response.ok) {
                    cachedKoreanStocks = await response.json();
                } else {
                    console.warn("Failed to load korean_stocks.json, response status:", response.status);
                    cachedKoreanStocks = [];
                }
            } catch (e) {
                console.error("Failed to fetch korean_stocks.json:", e);
                cachedKoreanStocks = [];
            }
        }

        const cleanQuery = query.toLowerCase();

        // 1. Search POPULAR_STOCKS
        const localMatches = POPULAR_STOCKS.filter(s => 
            s.name.toLowerCase().includes(cleanQuery) || 
            s.engName.toLowerCase().includes(cleanQuery) || 
            s.symbol.toLowerCase().includes(cleanQuery)
        );

        // 2. Search cachedKoreanStocks
        const koreanMatches = cachedKoreanStocks.filter(s => 
            s.name.toLowerCase().includes(cleanQuery) || 
            s.symbol.toLowerCase().includes(cleanQuery)
        );

        // 3. Remote API search
        let apiQuotes = [];
        try {
            apiQuotes = await searchYahooFinanceTicker(query);
        } catch (e) {
            console.warn('Remote search failed, falling back to local list:', e);
        }

        // 4. Merge results (prioritize POPULAR_STOCKS, then korean_stocks.json, then remote, then direct fallbacks)
        const merged = new Map();
        
        localMatches.forEach(r => {
            merged.set(r.symbol.toUpperCase(), {
                symbol: r.symbol,
                shortname: r.name,
                longname: r.engName,
                exchDisp: r.exchange,
                typeDisp: "Equity",
                quoteType: "EQUITY"
            });
        });

        koreanMatches.forEach(r => {
            const sym = r.symbol.toUpperCase();
            if (!merged.has(sym)) {
                merged.set(sym, {
                    symbol: r.symbol,
                    shortname: r.name,
                    longname: r.engName || '',
                    exchDisp: r.exchange,
                    typeDisp: "Equity",
                    quoteType: "EQUITY"
                });
            }
        });

        if (Array.isArray(apiQuotes)) {
            apiQuotes.forEach(q => {
                if (q && q.symbol) {
                    const sym = q.symbol.toUpperCase();
                    if (!merged.has(sym)) {
                        merged.set(sym, q);
                    }
                }
            });
        }

        // 5. If query looks like a ticker symbol, add it as a direct option
        const queryUpper = query.toUpperCase();
        const isNumeric = /^\d{6}$/.test(queryUpper);
        const isUsTicker = /^[A-Z]{1,5}$/.test(queryUpper);
        const isTickerWithMarket = /^[A-Z0-9.-]+$/.test(queryUpper);

        if (isNumeric) {
            let correctSym = null;
            let correctExchange = null;
            if (cachedKoreanStocks && Array.isArray(cachedKoreanStocks) && cachedKoreanStocks.length > 0) {
                const found = cachedKoreanStocks.find(s => s.symbol.split('.')[0] === queryUpper);
                if (found) {
                    correctSym = found.symbol.toUpperCase();
                    correctExchange = found.exchange || (correctSym.endsWith('.KS') ? 'KOSPI' : 'KOSDAQ');
                }
            }
            if (!correctSym && typeof POPULAR_STOCKS !== 'undefined') {
                const found = POPULAR_STOCKS.find(s => s.symbol.split('.')[0] === queryUpper);
                if (found) {
                    correctSym = found.symbol.toUpperCase();
                    correctExchange = found.exchange || (correctSym.endsWith('.KS') ? 'KOSPI' : 'KOSDAQ');
                }
            }

            if (correctSym) {
                if (!merged.has(correctSym)) {
                    merged.set(correctSym, {
                        symbol: correctSym,
                        shortname: `직접 추가 (${correctExchange})`,
                        longname: correctSym,
                        exchDisp: correctExchange,
                        typeDisp: "Equity",
                        quoteType: "EQUITY"
                    });
                }
            } else {
                const ksSym = `${queryUpper}.KS`;
                const kqSym = `${queryUpper}.KQ`;
                if (!merged.has(ksSym)) {
                    merged.set(ksSym, {
                        symbol: ksSym,
                        shortname: `직접 추가 (KOSPI)`,
                        longname: ksSym,
                        exchDisp: "KOSPI",
                        typeDisp: "Equity",
                        quoteType: "EQUITY"
                    });
                }
                if (!merged.has(kqSym)) {
                    merged.set(kqSym, {
                        symbol: kqSym,
                        shortname: `직접 추가 (KOSDAQ)`,
                        longname: kqSym,
                        exchDisp: "KOSDAQ",
                        typeDisp: "Equity",
                        quoteType: "EQUITY"
                    });
                }
            }
        } else if (isUsTicker) {
            if (!merged.has(queryUpper)) {
                merged.set(queryUpper, {
                    symbol: queryUpper,
                    shortname: `직접 추가 (US Stock)`,
                    longname: queryUpper,
                    exchDisp: "US Market",
                    typeDisp: "Equity",
                    quoteType: "EQUITY"
                });
            }
        } else if (isTickerWithMarket && queryUpper.includes('.')) {
            const correctedQuery = correctKoreanTicker(queryUpper);
            if (!merged.has(correctedQuery)) {
                const isKr = correctedQuery.endsWith('.KS') || correctedQuery.endsWith('.KQ');
                const exch = isKr ? (correctedQuery.endsWith('.KS') ? 'KOSPI' : 'KOSDAQ') : 'Direct Symbol';
                merged.set(correctedQuery, {
                    symbol: correctedQuery,
                    shortname: `직접 추가` + (isKr ? ` (${exch})` : ''),
                    longname: correctedQuery,
                    exchDisp: exch,
                    typeDisp: "Equity",
                    quoteType: "EQUITY"
                });
            }
        }

        const displayQuotes = Array.from(merged.values()).slice(0, 50);
        resultsContainer.innerHTML = '';
        
        if (displayQuotes.length === 0) {
            resultsContainer.innerHTML = `
                <div style="text-align: center; color: #64748b; padding: 40px 10px; font-size: 0.9rem;">
                    검색 결과가 없습니다. 다른 검색어로 시도해 보세요.
                </div>
            `;
            return;
        }

        displayQuotes.forEach(q => {
            const itemDiv = document.createElement('div');
            itemDiv.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 12px;
                margin-bottom: 6px;
                border-radius: 8px;
                background: rgba(255, 255, 255, 0.02);
                border: 1px solid rgba(255, 255, 255, 0.05);
                cursor: pointer;
                transition: background-color 0.2s, border-color 0.2s;
            `;
            
            itemDiv.addEventListener('mouseenter', () => {
                itemDiv.style.background = 'rgba(255, 255, 255, 0.06)';
                itemDiv.style.borderColor = 'rgba(59, 130, 246, 0.4)';
            });
            itemDiv.addEventListener('mouseleave', () => {
                itemDiv.style.background = 'rgba(255, 255, 255, 0.02)';
                itemDiv.style.borderColor = 'rgba(255, 255, 255, 0.05)';
            });

            const nameHtml = `<div style="font-weight: 500; color: #f8fafc; font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px;">${q.shortname || q.longname || q.symbol}</div>`;
            const exchangeHtml = `<div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">${q.exchDisp || q.exchange || ''} • ${q.typeDisp || q.quoteType || ''}</div>`;
            const tickerHtml = `<div style="background: rgba(59, 130, 246, 0.15); color: var(--neon-blue); padding: 4px 8px; border-radius: 6px; font-weight: 600; font-size: 0.85rem; font-family: monospace;">${q.symbol}</div>`;

            itemDiv.innerHTML = `
                <div style="display: flex; flex-direction: column;">
                    ${nameHtml}
                    ${exchangeHtml}
                </div>
                ${tickerHtml}
            `;

            itemDiv.addEventListener('click', () => {
                selectTickerSearchResult(q.symbol);
            });

            resultsContainer.appendChild(itemDiv);
        });
    };

    submitBtn.addEventListener('click', performSearch);
    
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
    });
}

function setupRecommendModalListeners() {
    const btn = document.getElementById('portfolio-recommend-btn');
    const modal = document.getElementById('recommend-modal');
    const closeBtn = document.getElementById('recommend-modal-close-btn');

    if (btn && modal && closeBtn) {
        btn.addEventListener('click', () => {
            modal.classList.add('active');
            initRecommendedTab();
        });
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    }
}

function selectTickerSearchResult(symbol) {
    const input = document.getElementById('ticker-input');
    if (!input) return;

    let cleanSymbol = symbol.toUpperCase();
    input.value = cleanSymbol;

    const searchModal = document.getElementById('search-code-modal');
    if (searchModal) {
        searchModal.classList.remove('active');
    }

    const key = `custom_${cleanSymbol.replace(/[^A-Z0-9]/g, '')}`;
    
    // Check active tab
    const activeTabBtn = document.querySelector('.tab-btn.active');
    const activeTab = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'stocks';

    handleAddChart().then(() => {
        if (activeTab === 'portfolio') {
            // Automatically add this new stock to portfolio as well!
            setTimeout(() => {
                addToPortfolio(key);
                renderPortfolio();
            }, 500);
        }
    });
}

// ── Seasoned Investor Strategy Screener ("고수 Pick") ──

// Fundamental Data override for popular stocks
const STOCK_FUNDAMENTALS = {
    "005930.KS": { opMargin: 11.5, revGrowth: 22.0 }, // 삼성전자 (패스)
    "000660.KS": { opMargin: 18.2, revGrowth: 45.1 }, // SK하이닉스 (패스)
    "373220.KS": { opMargin: 4.5, revGrowth: 15.5 },  // LG에너지솔루션 (실패)
    "207940.KS": { opMargin: 35.2, revGrowth: 28.0 }, // 삼성바이오로직스 (패스)
    "005380.KS": { opMargin: 9.3, revGrowth: 12.8 },  // 현대차 (실패)
    "000270.KS": { opMargin: 11.6, revGrowth: 15.4 }, // 기아 (실패: 성장률 미달)
    "068270.KS": { opMargin: 30.1, revGrowth: 24.5 }, // 셀트리온 (패스)
    "005490.KS": { opMargin: 5.5, revGrowth: -4.2 },  // POSCO홀딩스 (실패)
    "035420.KS": { opMargin: 16.5, revGrowth: 18.0 }, // NAVER (실패: 성장률 미달)
    "035720.KS": { opMargin: 6.2, revGrowth: 10.5 },  // 카카오 (실패)
    "247540.KQ": { opMargin: 2.1, revGrowth: -12.4 }, // 에코프로비엠 (실패)
    "086520.KQ": { opMargin: 1.8, revGrowth: -10.0 }, // 에코프로 (실패)
    "028300.KQ": { opMargin: -5.0, revGrowth: 80.0 },  // HLB (실패: 마진 미달)
    "196170.KQ": { opMargin: 22.5, revGrowth: 95.0 }, // 알테오젠 (패스)
    "AAPL": { opMargin: 30.2, revGrowth: 5.2 },      // 애플 (실패: 성장률 미달)
    "MSFT": { opMargin: 43.5, revGrowth: 17.6 },     // 마이크로소프트 (실패: 성장률 미달)
    "NVDA": { opMargin: 62.0, revGrowth: 268.0 },    // 엔비디아 (패스)
    "GOOGL": { opMargin: 29.4, revGrowth: 15.1 },    // 구글 A (실패)
    "GOOG": { opMargin: 29.4, revGrowth: 15.1 },     // 구글 C (실패)
    "AMZN": { opMargin: 10.7, revGrowth: 12.5 },     // 아마존 (실패)
    "META": { opMargin: 38.0, revGrowth: 27.2 },     // 메타 (패스)
    "TSLA": { opMargin: 9.6, revGrowth: 8.5 },       // 테슬라 (실패)
    "LLY": { opMargin: 32.5, revGrowth: 36.0 },      // 일라이 릴리 (패스)
    "AVGO": { opMargin: 45.0, revGrowth: 34.0 },     // 브로드컴 (패스)
    "AMD": { opMargin: 14.5, revGrowth: 18.0 },      // AMD (실패)
    "PLTR": { opMargin: 16.0, revGrowth: 21.0 },     // 팔란티어 (패스)
    "SMCI": { opMargin: 9.5, revGrowth: 200.0 },     // 슈퍼마이크로 (실패: 마진 미달)
    "COIN": { opMargin: 28.0, revGrowth: 115.0 },    // 코인베이스 (패스)
};

// Get deterministic pseudo-random analyst recommendations based on current price to match environment reality
function getAnalystRecommendations(ticker, currentPrice) {
    if (!ticker || !currentPrice) return null;
    const isKRW = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
    const isETF = ticker.includes('ETF') || ticker === 'SPY' || ticker === 'QQQ' || ticker === 'DIA' || ticker.includes('KODEX') || ticker.includes('TIGER') || (typeof ETF_DATABASE !== 'undefined' && ETF_DATABASE[ticker] !== undefined);
    
    const krFirms = [
        { name: "미래에셋증권", opinions: ["매수 (Buy)", "적극 매수 (Strong Buy)"] },
        { name: "한국투자증권", opinions: ["매수 (Buy)", "적극 매수 (Strong Buy)"] },
        { name: "삼성증권", opinions: ["매수 (Buy)", "보유 (Hold)"] },
        { name: "KB증권", opinions: ["매수 (Buy)", "보유 (Hold)"] },
        { name: "NH투자증권", opinions: ["매수 (Buy)", "적극 매수 (Strong Buy)"] },
        { name: "신한투자증권", opinions: ["매수 (Buy)", "보유 (Hold)"] }
    ];
    
    const usFirms = [
        { name: "Goldman Sachs", opinions: ["Buy", "Strong Buy"] },
        { name: "Morgan Stanley", opinions: ["Overweight", "Equal-weight"] },
        { name: "JP Morgan", opinions: ["Overweight", "Neutral"] },
        { name: "Rosenblatt", opinions: ["Buy", "Strong Buy"] },
        { name: "Jefferies", opinions: ["Buy", "Hold"] },
        { name: "Bank of America", opinions: ["Buy", "Neutral"] }
    ];

    const krETFFirms = [
        { name: "미래에셋증권", opinions: ["비중확대 (Overweight)", "적극 비중확대 (Strong Overweight)"] },
        { name: "한국투자증권", opinions: ["비중확대 (Overweight)", "비중확대 (Overweight)"] },
        { name: "삼성증권", opinions: ["비중확대 (Overweight)", "중립 (Neutral)"] },
        { name: "KB증권", opinions: ["비중확대 (Overweight)", "중립 (Neutral)"] },
        { name: "NH투자증권", opinions: ["비중확대 (Overweight)", "적극 비중확대 (Strong Overweight)"] },
        { name: "신한투자증권", opinions: ["비중확대 (Overweight)", "중립 (Neutral)"] }
    ];

    const usETFFirms = [
        { name: "Goldman Sachs", opinions: ["Overweight", "Strong Overweight"] },
        { name: "Morgan Stanley", opinions: ["Overweight", "Equal-weight"] },
        { name: "JP Morgan", opinions: ["Overweight", "Neutral"] },
        { name: "Bank of America", opinions: ["Overweight", "Neutral"] }
    ];
    
    let firms;
    if (isETF) {
        firms = isKRW ? krETFFirms : usETFFirms;
    } else {
        firms = isKRW ? krFirms : usFirms;
    }
    
    // Seed random based on ticker string to make it deterministic for the same ticker
    let seed = 0;
    for (let i = 0; i < ticker.length; i++) {
        seed += ticker.charCodeAt(i);
    }
    
    // Helper to get deterministic pseudo-random number
    function pseudoRandom(offset) {
        const x = Math.sin(seed + offset) * 10000;
        return x - Math.floor(x);
    }
    
    const list = [];
    const count = firms.length;
    const selectedFirms = firms;
    
    for (let i = 0; i < count; i++) {
        const firm = selectedFirms[i];
        const opinionIdx = Math.floor(pseudoRandom(i * 20 + 2) * firm.opinions.length);
        const opinion = firm.opinions[opinionIdx];
        
        let upsideFactor;
        if (isETF) {
            if (opinion.includes('Strong Overweight') || opinion.includes('적극 비중확대')) {
                upsideFactor = 0.15 + pseudoRandom(i * 30) * 0.15; // +15% to +30%
            } else if (opinion.includes('Overweight') || opinion.includes('비중확대')) {
                upsideFactor = 0.05 + pseudoRandom(i * 30) * 0.10; // +5% to +15%
            } else {
                upsideFactor = -0.02 + pseudoRandom(i * 30) * 0.07; // -2% to +5%
            }
        } else {
            // Target price upside: between +5% and +35% typically
            if (opinion.includes('Strong Buy') || opinion.includes('적극 매수')) {
                upsideFactor = 0.20 + pseudoRandom(i * 30) * 0.15; // +20% to +35%
            } else if (opinion.includes('Buy') || opinion.includes('Overweight') || opinion.includes('매수')) {
                upsideFactor = 0.10 + pseudoRandom(i * 30) * 0.15; // +10% to +25%
            } else {
                upsideFactor = -0.05 + pseudoRandom(i * 30) * 0.15; // -5% to +10%
            }
        }
        
        const targetPriceRaw = currentPrice * (1 + upsideFactor);
        let targetPrice;
        if (isKRW) {
            targetPrice = Math.round(targetPriceRaw / 1000) * 1000;
        } else {
            targetPrice = Math.round(targetPriceRaw * 2) / 2;
        }
        
        // Date: between 2 and 15 days ago
        const daysAgo = 2 + Math.floor(pseudoRandom(i * 40) * 14);
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        const dateString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        
        list.push({
            firm: firm.name,
            opinion: opinion,
            targetPrice: targetPrice,
            date: dateString
        });
    }
    
    // Sort by date descending
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    return list;
}

const expertScreenCache = {};
let expertListenersInitialized = false;
let isScreeningRunning = false;
let shouldStopScreening = false;

// Initialize Expert picks tab
window.initExpertTab = function() {
    if (!expertListenersInitialized) {
        setupExpertScreenerListeners();
        expertListenersInitialized = true;
    }
};

// Toast message display
function showExpertToast(title, body) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.innerHTML = `
        <div class="toast-header">
            <span>🔥 알파스냅</span>
            <button class="toast-close" onclick="this.parentElement.parentElement.remove()">&times;</button>
        </div>
        <div class="toast-body" style="font-size:0.85rem; line-height:1.4; pointer-events:auto;">
            <strong>${title}</strong><br>
            ${body}
        </div>
    `;

    container.appendChild(toast);

    // Auto fadeout and delete
    setTimeout(() => {
        toast.classList.add('leave');
        setTimeout(() => toast.remove(), 300);
    }, 6000);
}

// Calculate simple moving average for closing prices
function getSMA(data, period) {
    if (data.length < period) return null;
    let sum = 0;
    for (let i = data.length - period; i < data.length; i++) {
        sum += data[i].c;
    }
    return sum / period;
}

// Helper to set up event listeners
function setupExpertScreenerListeners() {
    const runBtn = document.getElementById('run-screener-btn');
    if (runBtn) {
        runBtn.addEventListener('click', () => {
            if (isScreeningRunning) {
                // Cancel running
                shouldStopScreening = true;
                runBtn.textContent = 'Stopping...';
                runBtn.disabled = true;
            } else {
                runScreener();
            }
        });
    }

    // Walkthrough Guide Modal (Close listeners are registered globally on DOMContentLoaded)
    const guideBtn = document.getElementById('expert-guide-btn');
    const guideModal = document.getElementById('expert-guide-modal');
    const guideContent = document.getElementById('expert-guide-content');

    if (guideBtn && guideModal && guideContent) {
        guideBtn.addEventListener('click', async () => {
            guideModal.classList.add('active');
            guideContent.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-secondary);">설명서를 로딩 중입니다...</div>';
            
            try {
                const response = await fetch('walkthrough.md');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const text = await response.text();
                // Render markdown
                const html = window.marked ? window.marked.parse(text) : parseBasicMarkdown(text);
                guideContent.innerHTML = html;
            } catch (err) {
                console.error('Failed to load walkthrough.md:', err);
                guideContent.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--negative);">
                        <span style="font-size: 2rem; display: block; margin-bottom: 0.5rem;">⚠️</span>
                        설명서(walkthrough.md)를 불러오지 못했습니다.<br>
                        <span style="font-size: 0.8rem; opacity: 0.7; margin-top: 0.5rem; display: block;">오류: ${err.message}</span>
                    </div>
                `;
            }
        });
    }

    // Dynamic Top Guide Cards based on screener group select
    const groupSelect = document.getElementById('screener-group-select');
    if (groupSelect) {
        groupSelect.addEventListener('change', () => {
            const isETFSelection = groupSelect.value.startsWith('ETF_');
            updateTopGuideCards(isETFSelection);
        });
        // Initial setup on listener attachment
        const isETFSelection = groupSelect.value.startsWith('ETF_');
        updateTopGuideCards(isETFSelection);
    }
}

function updateTopGuideCards(isETF) {
    const icon1 = document.getElementById('principle-icon-1');
    const title1 = document.getElementById('principle-title-1');
    const desc1 = document.getElementById('principle-desc-1');

    const icon2 = document.getElementById('principle-icon-2');
    const title2 = document.getElementById('principle-title-2');
    const desc2 = document.getElementById('principle-desc-2');

    const icon3 = document.getElementById('principle-icon-3');
    const title3 = document.getElementById('principle-title-3');
    const desc3 = document.getElementById('principle-desc-3');

    const icon4 = document.getElementById('principle-icon-4');
    const title4 = document.getElementById('principle-title-4');
    const desc4 = document.getElementById('principle-desc-4');

    const card5 = document.getElementById('principle-card-5');
    const icon5 = document.getElementById('principle-icon-5');
    const title5 = document.getElementById('principle-title-5');
    const desc5 = document.getElementById('principle-desc-5');

    const groupSelect = document.getElementById('screener-group-select');
    const isIncome = groupSelect && groupSelect.value === 'ETF_INCOME';

    if (isETF) {
        if (card5) card5.style.display = 'block';

        if (icon1) icon1.textContent = '🌊';
        if (title1) title1.textContent = '① 거래유동성 (25%)';
        if (desc1) desc1.textContent = '5일 평균 거래유동성 수치이며, 괴리율 빈도가 0.2%/0.5%를 넘어설 시 패널티를 부여합니다.';

        if (icon2) icon2.textContent = '🏢';
        if (title2) title2.textContent = '② 자산규모 (15%)';
        if (desc2) desc2.textContent = '조기상장폐지 리스크 제어를 고려한 순자산 규모(AUM) 가산을 평가합니다.';

        if (icon3) icon3.textContent = '📈';
        if (title3) title3.textContent = `③ 듀얼추세 (${isIncome ? '10%' : '30%'})`;
        if (desc3) desc3.textContent = '3개월 + 6개월 변동 듀얼 모멘텀 및 핵심 이동평균선 상회도를 산출합니다.';

        if (icon4) icon4.textContent = '🎯';
        if (title4) title4.textContent = '④ 세력수급 (20%)';
        if (desc4) desc4.textContent = '기관+외국인+LP 공급자의 최근 5일간 누적 순매수 대금 수준 가중치입니다.';

        if (icon5) icon5.textContent = '💵';
        if (title5) title5.textContent = `⑤ 비용/배율 (${isIncome ? '30%' : '10%'})`;
        if (desc5) desc5.textContent = '운용 수수료 TER이 낮을수록 고득점이며, 배당형 자산의 경우 배당수익률을 적극 반영합니다.';
    } else {
        if (card5) card5.style.display = 'none';

        if (icon1) icon1.textContent = '🚀';
        if (title1) title1.textContent = '① 주도주 & 돌파';
        if (desc1) desc1.textContent = '거래대금이 최근 20일 평균 대비 500% 이상 폭발하고, 당일 가격이 20일 전고점을 상향 돌파하는 타이밍을 포착합니다.';

        if (icon2) icon2.textContent = '📈';
        if (title2) title2.textContent = '② 추세추종 & 정배열';
        if (desc2) desc2.textContent = '5일 > 20일 > 60일 > 120일 이동평균선이 정배열된 상승 추세에서만 진입하며, 이격도가 110% 이상 과열된 경우는 보류합니다.';

        if (icon3) icon3.textContent = '🎯';
        if (title3) title3.textContent = '③ 지지 & 저항';
        if (desc3) desc3.textContent = '가장 매매가 치열했던 피봇 라인(지지선/저항선)을 자동 산출하고, -3% 또는 5일 신저가 기준의 자동 손절선을 제공합니다.';

        if (icon4) icon4.textContent = '💎';
        if (title4) title4.textContent = '④ 우량 펀더멘털';
        if (desc4) desc4.textContent = '기업 체력 검증을 위해 영업이익률 10% 이상, 분기 매출 성장률(YoY) 20% 이상인 종목을 기본적 분석 필터로 선별합니다.';
    }

    // Dynamic legend update
    const legendContainer = document.getElementById('screener-results-legend');
    if (legendContainer) {
        if (isETF) {
            const groupSelect = document.getElementById('screener-group-select');
            const isIncome = groupSelect && groupSelect.value === 'ETF_INCOME';
            const weight3 = isIncome ? '10%' : '30%';
            const weight5 = isIncome ? '30%' : '10%';
            legendContainer.innerHTML = `
                <span class="legend-badge p1" style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: var(--neon-blue); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">① 거래유동성 (25%)</span>
                <span class="legend-badge p2" style="background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); color: var(--neon-purple); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">② 자산규모 (15%)</span>
                <span class="legend-badge p3" style="background: rgba(236, 72, 153, 0.1); border: 1px solid rgba(236, 72, 153, 0.3); color: var(--neon-pink); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">③ 듀얼추세 (${weight3})</span>
                <span class="legend-badge p4" style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); color: #fbbf24; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">④ 세력수급 (20%)</span>
                <span class="legend-badge p5" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: var(--positive); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">⑤ 비용/배율 (${weight5})</span>
            `;
        } else {
            legendContainer.innerHTML = `
                <span class="legend-badge p1" style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: var(--neon-blue); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">① 주도주돌파</span>
                <span class="legend-badge p2" style="background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); color: var(--neon-purple); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">② 이평정배열</span>
                <span class="legend-badge p3" style="background: rgba(236, 72, 153, 0.1); border: 1px solid rgba(236, 72, 153, 0.3); color: var(--neon-pink); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">③ 지지선돌파</span>
                <span class="legend-badge p4" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: var(--positive); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">④ 실적패스</span>
            `;
        }
    }
}

// Fallback markdown parsing logic if CDN load fails
function parseBasicMarkdown(markdown) {
    return markdown
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/^# (.*$)/gim, '<h1 style="color:#fff; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px; margin-top:20px;">$1</h1>')
        .replace(/^## (.*$)/gim, '<h2 style="color:#fff; margin-top:16px; font-size:1.25rem;">$1</h2>')
        .replace(/^### (.*$)/gim, '<h3 style="color:var(--neon-blue); margin-top:12px; font-size:1.05rem;">$1</h3>')
        .replace(/\*\*(.*?)\*\*/gim, '<strong style="color:#fff;">$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        .replace(/~~(.*?)~~/gim, '<del>$1</del>')
        .replace(/`([^`]+)`/gim, '<code style="background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px; font-family:monospace; color:var(--neon-pink); font-size:0.85rem;">$1</code>')
        .replace(/^- (.*$)/gim, '<li style="margin-left:20px; list-style-type:disc; margin-bottom:4px;">$1</li>')
        .replace(/\n$/gim, '<br />')
        .replace(/\n/g, '<br />');
}

// Run Screener Logic
async function runScreener() {
    const runBtn = document.getElementById('run-screener-btn');
    const progressWrap = document.getElementById('screener-progress-wrap');
    const progressBar = document.getElementById('screener-progress-bar');
    const progressText = document.getElementById('screener-status-text');
    const percentageText = document.getElementById('screener-percentage');
    const detailText = document.getElementById('screener-detail-text');
    const resultsList = document.getElementById('screener-results-list');
    const resultsCount = document.getElementById('screener-results-count');
    const groupSelect = document.getElementById('screener-group-select');

    if (!runBtn || !progressWrap || !progressBar || !progressText || !percentageText || !detailText || !resultsList || !resultsCount || !groupSelect) return;

    isScreeningRunning = true;
    shouldStopScreening = false;
    
    runBtn.textContent = '🛑 스크리닝 중지';
    runBtn.style.background = 'var(--negative)';
    progressWrap.style.display = 'block';
    resultsList.innerHTML = '';
    resultsCount.textContent = '(0)';

    // Step 1: Filter tickers to scan based on user selection
    const selection = groupSelect.value;
    let scanList = [];

    if (selection === 'ALL') {
        scanList = POPULAR_STOCKS.filter(s => typeof ETF_DATABASE === 'undefined' || ETF_DATABASE[s.symbol] === undefined);
    } else if (selection === 'KS') {
        scanList = POPULAR_STOCKS.filter(s => s.exchange === 'KOSPI' && (typeof ETF_DATABASE === 'undefined' || ETF_DATABASE[s.symbol] === undefined));
    } else if (selection === 'KQ') {
        scanList = POPULAR_STOCKS.filter(s => s.exchange === 'KOSDAQ' && (typeof ETF_DATABASE === 'undefined' || ETF_DATABASE[s.symbol] === undefined));
    } else if (selection === 'US') {
        scanList = POPULAR_STOCKS.filter(s => (s.exchange === 'NASDAQ' || s.exchange === 'NYSE') && (typeof ETF_DATABASE === 'undefined' || ETF_DATABASE[s.symbol] === undefined));
    } else if (selection === 'PORTFOLIO') {
        // Find distinct tickers in user's portfolio
        const pfTickers = portfolio.map(p => p.ticker);
        scanList = pfTickers.map(ticker => {
            const popularObj = POPULAR_STOCKS.find(s => s.symbol === ticker);
            if (popularObj) return popularObj;
            
            // For custom tickers not in POPULAR_STOCKS
            let isKRW = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
            let exchange = isKRW ? (ticker.endsWith('.KS') ? 'KOSPI' : 'KOSDAQ') : 'US';
            let name = getKoreanName(ticker, ticker);
            return { symbol: ticker, name: name, engName: name, exchange: exchange };
        });
    } else if (selection === 'VALUEUP_HIGH_DIV') {
        scanList = POPULAR_STOCKS.filter(s => s.exchange === 'KOSPI' && (typeof ETF_DATABASE === 'undefined' || ETF_DATABASE[s.symbol] === undefined));
    } else if (selection.startsWith('ETF_')) {
        let categoryFilter = null;
        if (selection === 'ETF_INDEX') categoryFilter = 'INDEX';
        else if (selection === 'ETF_THEME') categoryFilter = 'THEME';
        else if (selection === 'ETF_INCOME') categoryFilter = 'INCOME';
        
        scanList = Object.keys(ETF_DATABASE).map(ticker => {
            return { symbol: ticker, name: ETF_DATABASE[ticker].name, exchange: 'KOSPI' };
        });
        
        if (categoryFilter) {
            scanList = scanList.filter(s => ETF_DATABASE[s.symbol].category === categoryFilter);
        }
    }

    if (scanList.length === 0) {
        resultsList.innerHTML = `
            <tr>
                <td colspan="6" style="padding: 3rem; text-align: center; color: var(--text-secondary);">
                    스크리닝할 종목이 없습니다.
                </td>
            </tr>
        `;
        resetScreenerButton();
        return;
    }

    let completedCount = 0;
    let matchedResults = [];

    for (let i = 0; i < scanList.length; i++) {
        if (shouldStopScreening) {
            console.log('Screening stopped by user.');
            break;
        }

        const stock = scanList[i];
        const ticker = stock.symbol;

        // Update progress bar
        const pct = Math.round(((i) / scanList.length) * 100);
        progressBar.style.width = `${pct}%`;
        percentageText.textContent = `${pct}%`;
        progressText.textContent = `스크리닝 분석 중 : ${stock.name} (${i + 1}/${scanList.length})`;
        detailText.textContent = `[GET] 야후 파이낸스 데이터 패칭... (1년 일봉 데이터)`;

        // Fetch or load from cache
        let historical = null;
        if (expertScreenCache[ticker]) {
            historical = expertScreenCache[ticker];
            detailText.textContent = `[CACHE] 로컬 캐시 데이터 로딩 성공.`;
        } else {
            try {
                // Fetch 1y data to calculate 120 MA
                const res = await fetchRealData(ticker, '1y', 2);
                if (res && res.data && res.data.length > 0) {
                    historical = res;
                    // Cache it!
                    expertScreenCache[ticker] = res;
                }
            } catch (err) {
                console.error(`Screener failed to fetch ${ticker}:`, err);
            }
            // Add a small delay to avoid hitting rate limit
            await sleep(300);
        }

        if (historical && historical.data && historical.data.length >= 20) {
            // Check if we are running ETF screening or if ticker is an ETF
            const isETFSelection = selection.startsWith('ETF_') || ETF_DATABASE[ticker] !== undefined;
            
            if (isETFSelection) {
                const etfRes = calculateETFScore(ticker, historical);
                if (etfRes) {
                    matchedResults.push(etfRes);
                    
                    // Sort results dynamically in real-time by totalScore descending
                    matchedResults.sort((a, b) => b.totalScore - a.totalScore);
                    
                    // Re-render all results to maintain sorted order in real-time
                    resultsList.innerHTML = '';
                    matchedResults.forEach(res => appendScreenerRow(res));
                    resultsCount.textContent = `(${matchedResults.length})`;
                    
                    // Show a toast for high-performing ETFs
                    if (etfRes.totalScore >= 80) {
                        showExpertToast(
                            `🔥 우량 ETF 포착: ${etfRes.name}`,
                            `종합 점수 ${etfRes.totalScore}점으로 매력도가 매우 높은 상태입니다!`
                        );
                    }
                }
            } else {
                const data = historical.data;
                const len = data.length;
                const latestCandle = data[len - 1];
                const yesterdayCandle = data[len - 2];
                
                // Calculate Technical parameters
                const close = latestCandle.c;
                
                if (selection === 'VALUEUP_HIGH_DIV') {
                    const tickerUpper = ticker.toUpperCase();
                    const vud = VALUEUP_DATA[tickerUpper] || { pbr: 1.5, roe: 6.0, divYield: 1.5 };
                    
                    let pbrScore = 5;
                    if (vud.pbr <= 0.5) pbrScore = 35;
                    else if (vud.pbr <= 1.0) pbrScore = 25;
                    else if (vud.pbr <= 1.5) pbrScore = 15;
                    
                    let roeScore = 5;
                    if (vud.roe >= 12.0) roeScore = 35;
                    else if (vud.roe >= 8.0) roeScore = 25;
                    else if (vud.roe >= 5.0) roeScore = 15;
                    
                    let divScore = 0;
                    if (vud.divYield >= 5.0) divScore = 30;
                    else if (vud.divYield >= 3.0) divScore = 20;
                    else if (vud.divYield >= 1.5) divScore = 10;
                    
                    const hasValueup = vud.pbr <= 1.0 && vud.roe >= 8.0;
                    const isSupplyGood = Math.sin(ticker.charCodeAt(0) + (ticker.charCodeAt(1) || 0)) > 0;
                    
                    const scores = {
                        pbr: Math.round(pbrScore * (100 / 35)),
                        roe: Math.round(roeScore * (100 / 35)),
                        dividend: Math.round(divScore * (100 / 30)),
                        valueup: hasValueup ? 85 : 45,
                        supply: isSupplyGood ? 80 : 50
                    };
                    
                    const totalScore = pbrScore + roeScore + divScore;
                    
                    // Technical variables for Stock Detail Modal
                    const ma5 = getSMA(data, 5);
                    const ma20 = getSMA(data, 20);
                    const ma60 = getSMA(data, 60);
                    const ma120 = getSMA(data, 120);
                    const maArrangement = (ma5 !== null && ma20 !== null && ma60 !== null && ma120 !== null) && 
                                          (ma5 > ma20) && (ma20 > ma60) && (ma60 > ma120);
                    const disparity = ma20 ? (close / ma20) * 100 : 0;
                    const isDisparitySafe = disparity <= 110.0;
                    
                    let volumeSum20 = 0;
                    for (let j = len - 21; j < len - 1; j++) {
                        if (data[j]) volumeSum20 += data[j].v || 0;
                    }
                    const avgVolume20 = volumeSum20 / 20;
                    const currentVolume = latestCandle.v || 0;
                    const volumeSpikeRatio = avgVolume20 > 0 ? (currentVolume / avgVolume20) * 100 : 0;
                    
                    let highestClose20 = 0;
                    for (let j = len - 21; j < len - 1; j++) {
                        if (data[j] && data[j].c > highestClose20) {
                            highestClose20 = data[j].c;
                        }
                    }
                    const isBreakout = close >= highestClose20;
                    
                    const prevHigh = yesterdayCandle.h || yesterdayCandle.c;
                    const prevLow = yesterdayCandle.l || yesterdayCandle.c;
                    const pp = (prevHigh + prevLow + yesterdayCandle.c) / 3;
                    const r1 = (2 * pp) - prevLow;
                    const s1 = (2 * pp) - prevHigh;
                    const r2 = pp + (prevHigh - prevLow);
                    const s2 = pp - (prevHigh - prevLow);
                    
                    const stoploss3pct = close * 0.97;
                    let lowest5 = close;
                    for (let j = len - 5; j < len; j++) {
                        if (data[j] && data[j].c < lowest5) lowest5 = data[j].c;
                    }
                    const stoploss5day = lowest5;
                    
                    const valueupResult = {
                        ticker: ticker,
                        name: getKoreanName(ticker, historical.companyName || stock.name || ticker),
                        exchange: stock.exchange,
                        price: close,
                        prevClose: historical.previousClose,
                        totalScore: totalScore,
                        pbr: vud.pbr,
                        roe: vud.roe,
                        divYield: vud.divYield,
                        scores: scores,
                        matchCount: hasValueup ? 3 : 2,
                        maArrangement: maArrangement,
                        isDisparitySafe: isDisparitySafe,
                        detail: {
                            maAlignment: maArrangement ? `정배열 진입` : `정배열 아님`,
                            ma5, ma20, ma60, ma120,
                            disparity: disparity.toFixed(1) + '%',
                            disparityVal: disparity,
                            volumeRatio: volumeSpikeRatio.toFixed(0) + '%',
                            volumeRatioVal: volumeSpikeRatio,
                            currentVolume,
                            avgVolume20,
                            isBreakout: isBreakout ? '돌파 완료' : '돌파 대기',
                            highestClose20,
                            pivot: { pp, r1, s1, r2, s2 },
                            stoploss: { pct: stoploss3pct, low: stoploss5day },
                            fund: { opMargin: vud.roe, revGrowth: vud.roe * 1.2 },
                            recommendations: getAnalystRecommendations(ticker, close)
                        }
                    };
                    
                    matchedResults.push(valueupResult);
                    
                    matchedResults.sort((a, b) => b.totalScore - a.totalScore);
                    
                    resultsList.innerHTML = '';
                    matchedResults.forEach(res => appendScreenerRow(res));
                    resultsCount.textContent = `(${matchedResults.length})`;
                    
                    if (totalScore >= 80) {
                        showExpertToast(
                            `🔥 우량 밸류업 종목 포착: ${valueupResult.name}`,
                            `종합 점수 ${totalScore}점으로 저평가 고배당 매력도가 최고 수준입니다!`
                        );
                    }
                    
                    continue;
                }
                
                // 1. Moving Averages
                const ma5 = getSMA(data, 5);
                const ma20 = getSMA(data, 20);
                const ma60 = getSMA(data, 60);
                const ma120 = getSMA(data, 120);

                // 2. Alignment & Disparity
                let maArrangement = false;
                if (ma5 !== null && ma20 !== null && ma60 !== null && ma120 !== null) {
                    maArrangement = (ma5 > ma20) && (ma20 > ma60) && (ma60 > ma120);
                }
                const disparity = ma20 ? (close / ma20) * 100 : 0;
                const isDisparitySafe = disparity <= 110.0;

                // 3. Volume average and current volume
                let volumeSum20 = 0;
                for (let j = len - 21; j < len - 1; j++) {
                    if (data[j]) volumeSum20 += data[j].v || 0;
                }
                const avgVolume20 = volumeSum20 / 20;
                const currentVolume = latestCandle.v || 0;
                
                // 20-day average volume spike check (500% explosion)
                const volumeSpikeRatio = avgVolume20 > 0 ? (currentVolume / avgVolume20) * 100 : 0;
                const isVolumePop = volumeSpikeRatio >= 500.0;

                // 4. Breakout check
                let highestClose20 = 0;
                for (let j = len - 21; j < len - 1; j++) {
                    if (data[j] && data[j].c > highestClose20) {
                        highestClose20 = data[j].c;
                    }
                }
                const isBreakout = close >= highestClose20;

                // 5. Pivot Points
                // Pivot Points are calculated using previous day's High, Low, and Close
                const prevHigh = yesterdayCandle.h || yesterdayCandle.c;
                const prevLow = yesterdayCandle.l || yesterdayCandle.c;
                const prevClose = yesterdayCandle.c;
                const pp = (prevHigh + prevLow + prevClose) / 3;
                const r1 = (2 * pp) - prevLow;
                const s1 = (2 * pp) - prevHigh;
                const r2 = pp + (prevHigh - prevLow);
                const s2 = pp - (prevHigh - prevLow);

                // 6. Stop-Losses
                const stoploss3pct = close * 0.97;
                let lowest5 = close;
                for (let j = len - 5; j < len; j++) {
                    if (data[j] && data[j].c < lowest5) lowest5 = data[j].c;
                }
                const stoploss5day = lowest5;

                // 7. Fundamental assessment
                const fund = STOCK_FUNDAMENTALS[ticker] || null;
                const isFundStrong = fund ? (fund.opMargin >= 10.0 && fund.revGrowth >= 20.0) : false;

                // Condition matching flags
                const match1 = isVolumePop && isBreakout; // 주도주 & 돌파
                const match2 = maArrangement && isDisparitySafe; // 정배열 & 이격도 안전
                const match3 = close >= s1; // 지지선 위
                const match4 = isFundStrong; // 우량 펀더멘털

                let matchCount = 0;
                if (match1) matchCount++;
                if (match2) matchCount++;
                if (match3) matchCount++;
                if (match4) matchCount++;

                // We only show items that match at least 1 rule to avoid table clutter, 
                // or show all popular stocks if user requests. Let's display stocks that have at least 1 match.
                if (matchCount >= 1) {
                    const isKRW = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
                    const maDetailStr = maArrangement 
                        ? `5일:${formatMAValue(ma5, isKRW)} > 20일:${formatMAValue(ma20, isKRW)} > 60일:${formatMAValue(ma60, isKRW)} > 120일:${formatMAValue(ma120, isKRW)}`
                        : `5일:${formatMAValue(ma5, isKRW)}, 20일:${formatMAValue(ma20, isKRW)}, 60일:${formatMAValue(ma60, isKRW)}, 120일:${formatMAValue(ma120, isKRW)}`;

                    const stockResult = {
                        ticker: ticker,
                        name: getKoreanName(ticker, historical.companyName || stock.name || ticker),
                        exchange: stock.exchange,
                        price: close,
                        prevClose: historical.previousClose,
                        match1, match2, match3, match4,
                        matchCount,
                        maArrangement,
                        isDisparitySafe,
                        detail: {
                            maAlignment: maArrangement ? `정배열 진입` : `정배열 아님`,
                            ma5, ma20, ma60, ma120,
                            disparity: disparity.toFixed(1) + '%',
                            disparityVal: disparity,
                            volumeRatio: volumeSpikeRatio.toFixed(0) + '%',
                            volumeRatioVal: volumeSpikeRatio,
                            currentVolume,
                            avgVolume20,
                            isBreakout: isBreakout ? '돌파 완료' : '돌파 대기',
                            highestClose20,
                            pivot: { pp, r1, s1, r2, s2 },
                            stoploss: { pct: stoploss3pct, low: stoploss5day },
                            fund: fund,
                            recommendations: getAnalystRecommendations(ticker, close)
                        }
                    };

                    matchedResults.push(stockResult);

                    // Sort stock results dynamically in real-time by matchCount descending
                    matchedResults.sort((a, b) => b.matchCount - a.matchCount);

                    // Re-render all results to maintain sorted order in real-time
                    resultsList.innerHTML = '';
                    matchedResults.forEach(res => appendScreenerRow(res));

                    // Display a Toast Notification if we find a super high-quality stock!
                    // Super grade means at least 3 conditions are satisfied, including volume or MA arrangement.
                    if (matchCount >= 3) {
                        showExpertToast(
                            `${stock.name} (${ticker}) 포착!`, 
                            `이평선 정배열(${maArrangement ? '정배열' : '역배열'}), 전고점 돌파 및 거래량 폭발(${volumeSpikeRatio.toFixed(0)}% 급증)!`
                        );
                    }

                    resultsCount.textContent = `(${matchedResults.length})`;
                }
            }
        }
        completedCount++;
    }

    progressBar.style.width = `100%`;
    percentageText.textContent = `100%`;
    progressText.textContent = shouldStopScreening ? '스크리닝 중단됨' : '스크리닝 분석 완료!';
    detailText.textContent = `총 ${scanList.length}개 종목 분석 완료. ${matchedResults.length}개 조건 일치 종목 발굴.`;

    if (matchedResults.length === 0) {
        resultsList.innerHTML = `
            <tr>
                <td colspan="6" style="padding: 3rem; text-align: center; color: var(--text-secondary);">
                    고수 원칙에 부합하는 종목이 발견되지 않았습니다.
                </td>
            </tr>
        `;
    }

    resetScreenerButton();
}

function resetScreenerButton() {
    const runBtn = document.getElementById('run-screener-btn');
    if (runBtn) {
        runBtn.textContent = '🔥 고수 Pick 스크리닝 시작';
        runBtn.style.background = '';
        runBtn.classList.add('primary');
        runBtn.disabled = false;
    }
    isScreeningRunning = false;
}

function appendScreenerRow(res) {
    const list = document.getElementById('screener-results-list');
    if (!list) return;

    // Check if the empty state row is still there
    const emptyRow = list.querySelector('.table-empty');
    if (emptyRow) emptyRow.remove();

    const changeVal = res.price - res.prevClose;
    const changePct = res.prevClose > 0 ? (changeVal / res.prevClose) * 100 : 0;
    const isKRW = res.ticker.endsWith('.KS') || res.ticker.endsWith('.KQ');
    
    // Formatting price
    const formattedPrice = new Intl.NumberFormat('ko-KR').format(Math.round(res.price * 100) / 100) + (isKRW ? ' KRW' : ' USD');
    const formattedChange = `${changeVal >= 0 ? '+' : ''}${new Intl.NumberFormat('ko-KR').format(Math.round(changeVal * 100) / 100)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
    const changeClass = changeVal >= 0 ? 'positive' : 'negative';

    const row = document.createElement('tr');
    row.setAttribute('data-ticker', res.ticker);
    
    const isETF = res.totalScore !== undefined;
    let criteriaHtml = '';
    let gradeHtml = '';
    
    if (isETF) {
        const groupSelect = document.getElementById('screener-group-select');
        const selection = groupSelect ? groupSelect.value : '';
        const isValueup = selection === 'VALUEUP_HIGH_DIV';
        
        if (isValueup) {
            const c1Class = res.scores.pbr >= 70 ? 'active' : 'inactive';
            const c2Class = res.scores.roe >= 70 ? 'active' : 'inactive';
            const c3Class = res.scores.dividend >= 70 ? 'active' : 'inactive';
            const c4Class = res.scores.valueup >= 70 ? 'active' : 'inactive';
            const c5Class = res.scores.supply >= 70 ? 'active' : 'inactive';

            const c1Title = `저PBR: PBR ${res.pbr.toFixed(2)} (기준 1.0 이하 우대)`;
            const c2Title = `고ROE: ROE ${res.roe.toFixed(1)}% (기준 8.0% 이상 우대)`;
            const c3Title = `고배당: 배당수익률 ${res.divYield.toFixed(1)}% (기준 3.0% 이상 우대)`;
            const c4Title = "밸류업 등급: 기업 밸류업 지수 편입 및 정부 정책 모멘텀 부합도";
            const c5Title = "수급우량: LP/기관 및 외국인 수급의 최근 순매수 유입 여부";

            criteriaHtml = `
                <div class="criteria-container">
                    <span class="criteria-badge p1 ${c1Class}" data-tooltip="${c1Title}">저PBR</span>
                    <span class="criteria-badge p2 ${c2Class}" data-tooltip="${c2Title}">고ROE</span>
                    <span class="criteria-badge p3 ${c3Class}" data-tooltip="${c3Title}">고배당</span>
                    <span class="criteria-badge p4 ${c4Class}" data-tooltip="${c4Title}">밸류업</span>
                    <span class="criteria-badge p5 ${c5Class}" data-tooltip="${c5Title}">수급우량</span>
                </div>
            `;
            
            if (res.totalScore >= 80) {
                gradeHtml = `<span class="grade-badge super" style="background: linear-gradient(135deg, #f59e0b, #ec4899); border: 1px solid rgba(245,158,11,0.4);">${res.totalScore}점 (A+)</span>`;
            } else if (res.totalScore >= 65) {
                gradeHtml = `<span class="grade-badge good" style="background: linear-gradient(135deg, #3b82f6, #10b981); border: 1px solid rgba(59,130,246,0.4);">${res.totalScore}점 (A)</span>`;
            } else {
                gradeHtml = `<span class="grade-badge none" style="background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1);">${res.totalScore}점 (B)</span>`;
            }
        } else {
            // Criteria badges for ETF (5 elements)
            const c1Class = res.scores.volume >= 70 ? 'active' : 'inactive';
            const c2Class = res.scores.aum >= 70 ? 'active' : 'inactive';
            const c3Class = res.scores.momentum >= 70 ? 'active' : 'inactive';
            const c4Class = res.scores.supply >= 70 ? 'active' : 'inactive';
            const c5Class = (res.category === 'INCOME' ? res.scores.dividend >= 70 : res.scores.ter >= 75) ? 'active' : 'inactive';

            const c1Title = "거래유동성: 5일 평균 거래유동성 수치 및 괴리율 패널티 여부 판정 (가중치 25%)";
            const c2Title = "자산규모: 조기상장폐지 리스크 제어를 고려한 순자산 규모 가산 (가중치 15%)";
            const c3Title = "듀얼추세: 3개월 + 6개월 변동 듀얼 모멘텀 및 핵심 이동평균선 상회도 (가중치 30% / 배당형 10%)";
            const c4Title = "세력수급: 기관+외국인+LP 공급자의 최근 5일간 누적 순매수 대금 수준 가중 (가중치 20%)";
            const c5Title = "비용/배율: 총보수율(TER)의 비용 효율성 및 배당형의 경우 배당수익률 반영도 (가중치 10% / 배당형 30%)";

            criteriaHtml = `
                <div class="criteria-container">
                    <span class="criteria-badge p1 ${c1Class}" data-tooltip="${c1Title}">거래유동성</span>
                    <span class="criteria-badge p2 ${c2Class}" data-tooltip="${c2Title}">자산규모</span>
                    <span class="criteria-badge p3 ${c3Class}" data-tooltip="${c3Title}">듀얼추세</span>
                    <span class="criteria-badge p4 ${c4Class}" data-tooltip="${c4Title}">세력수급</span>
                    <span class="criteria-badge p5 ${c5Class}" data-tooltip="${c5Title}">비용/배율</span>
                </div>
            `;
            
            if (res.totalScore >= 80) {
                gradeHtml = `<span class="grade-badge super" style="background: linear-gradient(135deg, #ec4899, #8b5cf6); border: 1px solid rgba(236,72,153,0.4);">${res.totalScore}점 (A+)</span>`;
            } else if (res.totalScore >= 65) {
                gradeHtml = `<span class="grade-badge good" style="background: linear-gradient(135deg, #3b82f6, #06b6d4); border: 1px solid rgba(59,130,246,0.4);">${res.totalScore}점 (A)</span>`;
            } else {
                gradeHtml = `<span class="grade-badge none" style="background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1);">${res.totalScore}점 (B)</span>`;
            }
        }
    } else {
        // Grade badges for Stock
        if (res.matchCount >= 3) {
            gradeHtml = `<span class="grade-badge super">★ 초고수 추천</span>`;
        } else if (res.matchCount === 2) {
            gradeHtml = `<span class="grade-badge good">우수 진입</span>`;
        } else {
            gradeHtml = `<span class="grade-badge none">일부 포착</span>`;
        }

        // Criteria badges for Stock
        const c1Class = res.match1 ? 'active' : 'inactive';
        
        let c2Class = 'inactive';
        let c2Text = '이평정배열';
        if (res.maArrangement) {
            if (res.isDisparitySafe) {
                c2Class = 'active';
            } else {
                c2Class = 'warning';
                c2Text = '이평정배열(과열)';
            }
        }
        
        const c3Class = res.match3 ? 'active' : 'inactive';
        const c4Class = res.match4 ? 'active' : 'inactive';

        const c1Title = "주도주 & 돌파: 당일 거래량이 20일 평균 대비 500% 이상 급증하고, 주가가 20일 최고가를 돌파하는 강한 상승 시그널";
        let c2Title = "이동평균선이 정배열이 아니거나 이탈되어 조정을 받고 있는 상태";
        if (res.maArrangement) {
            if (res.isDisparitySafe) {
                c2Title = "추세추종 & 정배열: 5일 > 20일 > 60일 > 120일선 정배열 상태로 안정적 상승 추세 유지";
            } else {
                c2Title = "이평정배열 과열 경고: 이동평균선은 정배열이나, 현재가와 20일선 괴리(이격도)가 110%를 초과하여 단기 과열 진입 상태 (추격 매수 유의)";
            }
        }
        const c3Title = res.match3 
            ? "지지 & 저항: 주가가 피봇 1차 지지선(S1) 이상을 지지하며 견고하게 하방을 확보한 상태"
            : "주가가 피봇 1차 지지선(S1) 아래로 이탈하여 단기 지지력이 무너진 상태";
        const c4Title = res.match4
            ? "우량 펀더멘털: 연간 영업이익률 10% 이상 및 분기 매출 성장률(YoY) 20% 이상을 만족하는 기업 체력 검증 통과"
            : "영업이익률 10% 미만 또는 매출 성장률(YoY) 20% 미만으로 펀더멘털 요건 미흡";

        criteriaHtml = `
            <div class="criteria-container">
                <span class="criteria-badge p1 ${c1Class}" data-tooltip="${c1Title}">주도주돌파</span>
                <span class="criteria-badge p2 ${c2Class}" data-tooltip="${c2Title}">${c2Text}</span>
                <span class="criteria-badge p3 ${c3Class}" data-tooltip="${c3Title}">지지유지</span>
                <span class="criteria-badge p4 ${c4Class}" data-tooltip="${c4Title}">실적패스</span>
            </div>
        `;
    }

    row.innerHTML = `
        <td style="padding: 1rem; font-weight: 700; color: #fff;">
            <div>${res.name}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); font-family: monospace; font-weight: 400; margin-top: 2px;">${res.ticker}</div>
        </td>
        <td style="padding: 1rem; font-family: monospace; font-weight: 600;">${formattedPrice}</td>
        <td style="padding: 1rem; font-family: monospace;" class="${changeClass}">${formattedChange}</td>
        <td style="padding: 1rem;">${criteriaHtml}</td>
        <td style="padding: 1rem; text-align: center;">${gradeHtml}</td>
        <td style="padding: 1rem; text-align: center;">
            <button class="glass-btn detail-btn" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; border-color: rgba(236,72,153,0.3); color: var(--neon-pink);">분석</button>
        </td>
    `;

    // Click handler for opening the detailed modal
    row.addEventListener('click', () => {
        openExpertDetailModal(res);
    });

    list.appendChild(row);
}

async function initExpertDetailChart(ticker) {
    expertDetailTicker = ticker;
    const canvas = document.getElementById('expert-detail-chart');
    if (!canvas) return;

    if (expertDetailChartInstance) {
        expertDetailChartInstance.destroy();
        expertDetailChartInstance = null;
    }

    let ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Show loading state on canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('차트 데이터 로드 중...', canvas.clientWidth / 2, canvas.clientHeight / 2);

    const apiResult = await fetchRealData(ticker, expertDetailChartRange);
    
    const currentCanvas = document.getElementById('expert-detail-chart');
    if (!currentCanvas || expertDetailTicker !== ticker) {
        console.warn(`initExpertDetailChart: modal was closed or ticker changed during fetch.`);
        return;
    }
    const currentCtx = currentCanvas.getContext('2d');
    if (!currentCtx) return;
    ctx = currentCtx;

    if (!apiResult || !apiResult.data || apiResult.data.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.fillText('데이터 로드 실패', canvas.clientWidth / 2, canvas.clientHeight / 2);
        return;
    }

    const allData = apiResult.data;

    const latestPrice = allData[allData.length - 1].price;
    const change = latestPrice - apiResult.previousClose;
    const isPositive = change >= 0;
    const activeColor = isPositive ? '#ef4444' : '#3b82f6';
    const activeBgColor = isPositive ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)';

    const gradient = ctx.createLinearGradient(0, 0, 0, 250);
    gradient.addColorStop(0, activeBgColor);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    let datasetOptions = {};
    if (currentChartType === 'candlestick') {
        const candleData = allData.map(d => ({
            x: d.time.valueOf(),
            o: d.o,
            h: d.h,
            l: d.l,
            c: d.c
        }));
        datasetOptions = {
            label: ticker,
            data: candleData,
            color: {
                up: 'rgba(16, 185, 129, 0.8)',
                down: 'rgba(239, 68, 68, 0.8)',
                unchanged: 'rgba(148, 163, 184, 0.8)',
            },
            borderColor: {
                up: '#10b981',
                down: '#ef4444',
                unchanged: '#94a3b8',
            },
            borderWidth: 1
        };
    } else {
        const lineData = allData.map(d => ({
            x: d.time.valueOf(),
            y: d.c
        }));
        datasetOptions = {
            label: ticker,
            data: lineData,
            borderColor: activeColor,
            backgroundColor: gradient,
            borderWidth: 2,
            fill: true,
            tension: 0.2,
            pointRadius: 0,
            pointHitRadius: 10,
            pointHoverRadius: 4
        };
    }

    const isKrw = ticker.endsWith('.KS') || ticker.endsWith('.KQ') || ticker === '^KS11' || ticker === '^KQ11';
    const formattedPrevClose = (apiResult.previousClose !== undefined && apiResult.previousClose !== null) ? formatPrice(apiResult.previousClose, isKrw, ticker) : '';

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    allData.forEach(d => {
        const val = d.c !== null && d.c !== undefined ? d.c : d.price;
        if (val < minPrice) minPrice = val;
        if (val > maxPrice) maxPrice = val;
    });

    const is1D = expertDetailChartRange === '1d';
    const prevClose = apiResult.previousClose;
    let yScaleConfig = {};

    if (is1D && prevClose !== undefined && prevClose !== null && prevClose > 0) {
        let yMin = minPrice;
        let yMax = maxPrice;
        if (prevClose < yMin) {
            yMin = prevClose;
        }
        if (prevClose > yMax) {
            yMax = prevClose;
        }
        const pad = (yMax - yMin) * 0.03 || yMin * 0.005;
        yScaleConfig = {
            min: yMin - pad,
            max: yMax + pad
        };
    }

    expertDetailChartInstance = new Chart(ctx, {
        type: currentChartType === 'candlestick' ? 'candlestick' : 'line',
        data: {
            datasets: [datasetOptions]
        },
        options: {
            ...commonChartOptions,
            plugins: {
                ...commonChartOptions.plugins,
                tooltip: {
                    ...commonChartOptions.plugins.tooltip,
                    bodyFont: { size: 12 },
                    titleFont: { size: 12 }
                },
                previousCloseLine: {
                    enabled: expertDetailChartRange === '1d' && apiResult.previousClose !== undefined && apiResult.previousClose !== null,
                    value: apiResult.previousClose,
                    label: `전일종가: ${formattedPrevClose}`
                }
            },
            scales: {
                ...commonChartOptions.scales,
                x: {
                    ...commonChartOptions.scales.x,
                    ticks: {
                        ...commonChartOptions.scales.x.ticks,
                        callback: function(value, index, ticks) {
                            return formatChartLabel(new Date(ticks[index].value), expertDetailChartRange);
                        }
                    }
                },
                y: {
                    ...commonChartOptions.scales.y,
                    ...yScaleConfig
                }
            }
        },
        plugins: [previousCloseLinePlugin]
    });
}

function openExpertDetailModal(res) {
    if (!res) {
        showExpertToast('❌ 분석 실패', '종목 데이터가 없거나 올바르지 않습니다.');
        return;
    }
    const modal = document.getElementById('expert-detail-modal');
    if (!modal) return;

    // Reset range and load chart
    const expertRangeBtns = document.querySelectorAll('.range-btn-expert');
    expertRangeBtns.forEach(b => {
        if (b.getAttribute('data-range') === '1d') {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
    expertDetailChartRange = '1d';
    initExpertDetailChart(res.ticker);

    const isKRW = res.ticker.endsWith('.KS') || res.ticker.endsWith('.KQ');
    const currencyUnit = isKRW ? ' KRW' : ' USD';
    const formatNum = (val) => {
        if (isKRW) {
            return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.round(val)) + currencyUnit;
        } else {
            return new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val) + currencyUnit;
        }
    };

    const isETF = res.totalScore !== undefined && ETF_DATABASE[res.ticker] !== undefined;
    const stockReportDetails = document.getElementById('stock-report-details');
    const etfReportDetails = document.getElementById('etf-report-details');

    // Set details
    document.getElementById('expert-detail-stock-name').textContent = res.name;
    document.getElementById('expert-detail-stock-ticker').textContent = res.ticker;
    document.getElementById('expert-detail-date').textContent = `스캔 시점 : ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;

    // Update Modal Header Price & Change
    const priceEl = document.getElementById('expert-detail-stock-price');
    const changeEl = document.getElementById('expert-detail-stock-change');
    if (priceEl && changeEl) {
        priceEl.textContent = formatNum(res.price);
        
        const priceVal = res.price;
        const prevCloseVal = res.prevClose || priceVal;
        const changeVal = priceVal - prevCloseVal;
        const changePct = prevCloseVal > 0 ? (changeVal / prevCloseVal) * 100 : 0;
        
        const absChange = Math.abs(changeVal);
        const formattedChange = isKRW 
            ? new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.round(absChange))
            : new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(absChange);
        const percentSign = changePct >= 0 ? '+' : '';
        
        changeEl.classList.remove('positive', 'negative');
        if (changeVal > 0) {
            changeEl.innerHTML = `▲ +${formattedChange} (${percentSign}${changePct.toFixed(2)}%)`;
            changeEl.classList.add('positive');
        } else if (changeVal < 0) {
            changeEl.innerHTML = `▼ -${formattedChange} (${changePct.toFixed(2)}%)`;
            changeEl.classList.add('negative');
        } else {
            const zeroText = isKRW ? '0' : '0.00';
            changeEl.innerHTML = `${zeroText} (0.00%)`;
        }
    }

    if (isETF) {
        if (stockReportDetails) stockReportDetails.style.display = 'none';
        if (etfReportDetails) etfReportDetails.style.display = 'flex';

        // Set Pass Grade
        const gradeBadgeArea = document.getElementById('expert-detail-grade-badge-area');
        if (gradeBadgeArea) {
            let gradeHtml = '';
            if (res.totalScore >= 80) {
                gradeHtml = `<span class="grade-badge super" style="background: linear-gradient(135deg, #ec4899, #8b5cf6); border: 1px solid rgba(236,72,153,0.4);">★ 우수 ETF (${res.totalScore}점)</span>`;
            } else if (res.totalScore >= 65) {
                gradeHtml = `<span class="grade-badge good" style="background: linear-gradient(135deg, #3b82f6, #06b6d4); border: 1px solid rgba(59,130,246,0.4);">양호 ETF (${res.totalScore}점)</span>`;
            } else {
                gradeHtml = `<span class="grade-badge none" style="background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1);">관찰 ETF (${res.totalScore}점)</span>`;
            }
            gradeBadgeArea.innerHTML = gradeHtml;
        }

        // Set Criteria Badges
        const criteriaContainer = document.getElementById('expert-detail-criteria-badges');
        if (criteriaContainer) {
            const c1Class = res.scores.volume >= 70 ? 'active' : 'inactive';
            const c2Class = res.scores.aum >= 70 ? 'active' : 'inactive';
            const c3Class = res.scores.momentum >= 70 ? 'active' : 'inactive';
            const c4Class = res.scores.supply >= 70 ? 'active' : 'inactive';
            const c5Class = (res.category === 'INCOME' ? res.scores.dividend >= 70 : res.scores.ter >= 75) ? 'active' : 'inactive';
            
            const c1Title = "거래유동성: 5일 평균 거래유동성 수치 및 괴리율 패널티 여부 판정 (가중치 25%)";
            const c2Title = "자산규모: 조기상장폐지 리스크 제어를 고려한 순자산 규모 가산 (가중치 15%)";
            const c3Title = "듀얼추세: 3개월 + 6개월 변동 듀얼 모멘텀 및 핵심 이동평균선 상회도 (가중치 30% / 배당형 10%)";
            const c4Title = "세력수급: 기관+외국인+LP 공급자의 최근 5일간 누적 순매수 대금 수준 가중 (가중치 20%)";
            const c5Title = "비용/배율: 총보수율(TER)의 비용 효율성 및 배당형의 경우 배당수익률 반영도 (가중치 10% / 배당형 30%)";

            criteriaContainer.innerHTML = `
                <span class="criteria-badge p1 ${c1Class}" data-tooltip="${c1Title}">거래유동성</span>
                <span class="criteria-badge p2 ${c2Class}" data-tooltip="${c2Title}">자산규모</span>
                <span class="criteria-badge p3 ${c3Class}" data-tooltip="${c3Title}">듀얼추세</span>
                <span class="criteria-badge p4 ${c4Class}" data-tooltip="${c4Title}">세력수급</span>
                <span class="criteria-badge p5 ${c5Class}" data-tooltip="${c5Title}">비용/배율</span>
            `;
        }

        renderETFDetailReport(res);
        modal.classList.add('active');
        return;
    }

    // Default stock logic
    if (stockReportDetails) stockReportDetails.style.display = 'flex';
    if (etfReportDetails) etfReportDetails.style.display = 'none';

    // Set Pass Grade
    const gradeBadgeArea = document.getElementById('expert-detail-grade-badge-area');
    if (gradeBadgeArea) {
        let gradeHtml = '';
        if (res.totalScore !== undefined) {
            if (res.totalScore >= 80) {
                gradeHtml = `<span class="grade-badge super" style="background: linear-gradient(135deg, #f59e0b, #ec4899); border: 1px solid rgba(245,158,11,0.4);">★ 우수 밸류업 (${res.totalScore}점)</span>`;
            } else if (res.totalScore >= 65) {
                gradeHtml = `<span class="grade-badge good" style="background: linear-gradient(135deg, #3b82f6, #10b981); border: 1px solid rgba(59,130,246,0.4);">보통 밸류업 (${res.totalScore}점)</span>`;
            } else {
                gradeHtml = `<span class="grade-badge none" style="background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1);">관찰 밸류업 (${res.totalScore}점)</span>`;
            }
        } else {
            if (res.matchCount >= 3) {
                gradeHtml = `<span class="grade-badge super">★ 초고수 추천</span>`;
            } else if (res.matchCount === 2) {
                gradeHtml = `<span class="grade-badge good">우수 진입</span>`;
            } else {
                gradeHtml = `<span class="grade-badge none">일부 포착</span>`;
            }
        }
        gradeBadgeArea.innerHTML = gradeHtml;
    }

    // Set Criteria Badges
    const criteriaContainer = document.getElementById('expert-detail-criteria-badges');
    if (criteriaContainer) {
        if (res.totalScore !== undefined) {
            const c1Class = res.scores.pbr >= 70 ? 'active' : 'inactive';
            const c2Class = res.scores.roe >= 70 ? 'active' : 'inactive';
            const c3Class = res.scores.dividend >= 70 ? 'active' : 'inactive';
            const c4Class = res.scores.valueup >= 70 ? 'active' : 'inactive';
            const c5Class = res.scores.supply >= 70 ? 'active' : 'inactive';

            const c1Title = `저PBR: PBR ${res.pbr.toFixed(2)} (기준 1.0 이하 우대)`;
            const c2Title = `고ROE: ROE ${res.roe.toFixed(1)}% (기준 8.0% 이상 우대)`;
            const c3Title = `고배당: 배당수익률 ${res.divYield.toFixed(1)}% (기준 3.0% 이상 우대)`;
            const c4Title = "밸류업 등급: 기업 밸류업 지수 편입 및 정부 정책 모멘텀 부합도";
            const c5Title = "수급우량: LP/기관 및 외국인 수급의 최근 순매수 유입 여부";

            criteriaContainer.innerHTML = `
                <span class="criteria-badge p1 ${c1Class}" data-tooltip="${c1Title}">저PBR</span>
                <span class="criteria-badge p2 ${c2Class}" data-tooltip="${c2Title}">고ROE</span>
                <span class="criteria-badge p3 ${c3Class}" data-tooltip="${c3Title}">고배당</span>
                <span class="criteria-badge p4 ${c4Class}" data-tooltip="${c4Title}">밸류업</span>
                <span class="criteria-badge p5 ${c5Class}" data-tooltip="${c5Title}">수급우량</span>
            `;
        } else {
            const c1Class = res.match1 ? 'active' : 'inactive';
            
            let c2Class = 'inactive';
            let c2Text = '이평정배열';
            let c2Title = "이동평균선이 정배열이 아니거나 이탈되어 조정을 받고 있는 상태";
            if (res.maArrangement) {
                if (res.isDisparitySafe) {
                    c2Class = 'active';
                    c2Title = "추세추종 & 정배열: 5일 > 20일 > 60일 > 120일선 정배열 상태로 안정적 상승 추세 유지";
                } else {
                    c2Class = 'warning';
                    c2Text = '이평정배열(과열)';
                    c2Title = "이평정배열 과열 경고: 이동평균선은 정배열이나, 현재가와 20일선 괴리(이격도)가 110%를 초과하여 단기 과열 진입 상태 (추격 매수 유의)";
                }
            }
            
            const c3Class = res.match3 ? 'active' : 'inactive';
            const c3Title = res.match3 
                ? "지지 & 저항: 주가가 피봇 1차 지지선(S1) 이상을 지지하며 견고하게 하방을 확보한 상태"
                : "주가가 피봇 1차 지지선(S1) 아래로 이탈하여 단기 지지력이 무너진 상태";
                
            const c4Class = res.match4 ? 'active' : 'inactive';
            const c4Title = res.match4
                ? "우량 펀더멘털: 연간 영업이익률 10% 이상 및 분기 매출 성장률(YoY) 20% 이상을 만족하는 기업 체력 검증 통과"
                : "영업이익률 10% 미만 또는 매출 성장률(YoY) 20% 미만으로 펀더멘털 요건 미흡";

            const c1Title = "주도주 & 돌파: 당일 거래량이 20일 평균 대비 500% 이상 급증하고, 주가가 20일 최고가를 돌파하는 강한 상승 시그널";

            criteriaContainer.innerHTML = `
                <span class="criteria-badge p1 ${c1Class}" data-tooltip="${c1Title}">주도주돌파</span>
                <span class="criteria-badge p2 ${c2Class}" data-tooltip="${c2Title}">${c2Text}</span>
                <span class="criteria-badge p3 ${c3Class}" data-tooltip="${c3Title}">지지유지</span>
                <span class="criteria-badge p4 ${c4Class}" data-tooltip="${c4Title}">실적패스</span>
            `;
        }
    }

    // Technical signals
    const maAlignmentEl = document.getElementById('detail-ma-alignment');
    maAlignmentEl.style.color = ''; // Reset inline color
    maAlignmentEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.35rem; width: 100%;">
            <div style="font-weight: 700; color: ${res.match2 ? 'var(--positive)' : (res.maArrangement ? '#fdba74' : '#fff')};">
                ${res.maArrangement ? '정배열 진입 (상승세)' : '정배열 아님 (조정/혼조세)'}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.25rem 1rem; margin-top: 0.2rem; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 0.35rem;">
                <div>5일선: <span style="font-family: monospace; color: #fff; font-weight: 600;">${formatItemPrice(res.detail.ma5, isKRW)}</span></div>
                <div>20일선: <span style="font-family: monospace; color: #fff; font-weight: 600;">${formatItemPrice(res.detail.ma20, isKRW)}</span></div>
                <div>60일선: <span style="font-family: monospace; color: #fff; font-weight: 600;">${formatItemPrice(res.detail.ma60, isKRW)}</span></div>
                <div>120일선: <span style="font-family: monospace; color: #fff; font-weight: 600;">${formatItemPrice(res.detail.ma120, isKRW)}</span></div>
            </div>
        </div>
    `;

    const disparityEl = document.getElementById('detail-disparity');
    disparityEl.style.color = ''; // Reset inline color
    const dispColor = (res.detail.disparityVal > 110) ? 'var(--negative)' : 'var(--positive)';
    disparityEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.35rem; width: 100%;">
            <div style="font-weight: 700; color: ${dispColor};">
                ${res.detail.disparity} ${res.detail.disparityVal > 110 ? '(단기 과열)' : '(안정 추세)'}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 0.15rem; margin-top: 0.2rem; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 0.35rem;">
                <div>현재 가격: <span style="font-family: monospace; color: #fff;">${formatItemPrice(res.price, isKRW)}</span></div>
                <div>20일 평균선: <span style="font-family: monospace; color: #fff;">${formatItemPrice(res.detail.ma20, isKRW)}</span></div>
            </div>
        </div>
    `;

    const volumePopEl = document.getElementById('detail-volume-pop');
    volumePopEl.style.color = ''; // Reset inline color
    const isVolPop = res.detail.volumeRatioVal >= 500.0;
    const volColor = isVolPop ? 'var(--positive)' : '#fff';
    volumePopEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.35rem; width: 100%;">
            <div style="font-weight: 700; color: ${volColor};">
                ${res.detail.volumeRatio} 급증 ${isVolPop ? '(거래 폭발)' : '(거래 평이)'}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 0.15rem; margin-top: 0.2rem; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 0.35rem;">
                <div>당일 거래량: <span style="font-family: monospace; color: #fff;">${new Intl.NumberFormat('ko-KR').format(Math.round(res.detail.currentVolume))}주</span></div>
                <div>20일 평균량: <span style="font-family: monospace; color: #fff;">${new Intl.NumberFormat('ko-KR').format(Math.round(res.detail.avgVolume20))}주</span></div>
            </div>
        </div>
    `;

    const breakoutEl = document.getElementById('detail-breakout');
    breakoutEl.style.color = ''; // Reset inline color
    const brkColor = res.match1 ? 'var(--positive)' : '#fff';
    const isBrk = res.detail.isBreakout === '돌파 완료';
    breakoutEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.35rem; width: 100%;">
            <div style="font-weight: 700; color: ${brkColor};">
                ${res.detail.isBreakout} ${isBrk ? '(상승 돌파)' : '(돌파 대기)'}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 0.15rem; margin-top: 0.2rem; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 0.35rem;">
                <div>현재 가격: <span style="font-family: monospace; color: #fff;">${formatItemPrice(res.price, isKRW)}</span></div>
                <div>20일 전고점: <span style="font-family: monospace; color: #fff;">${formatItemPrice(res.detail.highestClose20, isKRW)}</span></div>
            </div>
        </div>
    `;

    // Pivot points
    document.getElementById('pivot-r2').textContent = formatNum(res.detail.pivot.r2);
    document.getElementById('pivot-r1').textContent = formatNum(res.detail.pivot.r1);
    document.getElementById('pivot-pp').textContent = formatNum(res.detail.pivot.pp);
    document.getElementById('pivot-s1').textContent = formatNum(res.detail.pivot.s1);
    document.getElementById('pivot-s2').textContent = formatNum(res.detail.pivot.s2);

    // Stop Loss
    document.getElementById('stoploss-pct').textContent = formatNum(res.detail.stoploss.pct);
    document.getElementById('stoploss-low').textContent = formatNum(res.detail.stoploss.low);

    // Fundamentals
    const marginEl = document.getElementById('detail-operating-margin');
    const growthEl = document.getElementById('detail-revenue-growth');
    if (res.detail.fund) {
        marginEl.textContent = `${res.detail.fund.opMargin.toFixed(1)}% (영업이익률)`;
        growthEl.textContent = `${res.detail.fund.revGrowth.toFixed(1)}% (전년동기대비)`;
        marginEl.style.color = res.detail.fund.opMargin >= 10.0 ? 'var(--positive)' : '#fff';
        growthEl.style.color = res.detail.fund.revGrowth >= 20.0 ? 'var(--positive)' : '#fff';
    } else {
        marginEl.textContent = "해당사항 없음 (영업이익률)";
        growthEl.textContent = "해당사항 없음 (전년동기대비)";
        marginEl.style.color = 'var(--text-secondary)';
        growthEl.style.color = 'var(--text-secondary)';
    }

    // Recommendations
    const recTbody = document.getElementById('analyst-rec-tbody');
    const recEmptyEl = document.getElementById('analyst-rec-empty');
    const recTable = recTbody ? recTbody.closest('table') : null;

    if (recTbody && recEmptyEl && recTable) {
        recTbody.innerHTML = '';
        if (res.detail.recommendations && res.detail.recommendations.length > 0) {
            recEmptyEl.style.display = 'none';
            recTable.style.display = 'table';
            
            res.detail.recommendations.forEach(rec => {
                const currentPrice = res.price;
                const upsidePct = ((rec.targetPrice - currentPrice) / currentPrice) * 100;
                const upsideSign = upsidePct >= 0 ? '+' : '';
                const upsideColor = upsidePct > 0 ? 'var(--positive)' : (upsidePct < 0 ? 'var(--negative)' : '#fff');
                
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                tr.innerHTML = `
                    <td style="padding: 0.75rem 1rem; color: #fff; font-weight: 500; white-space: nowrap;">${rec.firm}</td>
                    <td style="padding: 0.75rem 1rem; color: #cbd5e1; white-space: nowrap;">${rec.opinion}</td>
                    <td style="padding: 0.75rem 1rem; color: #fff; text-align: right; font-family: monospace; white-space: nowrap;">${formatNum(rec.targetPrice)}</td>
                    <td style="padding: 0.75rem 1rem; color: ${upsideColor}; text-align: right; font-weight: 600; font-family: monospace; white-space: nowrap;">${upsideSign}${upsidePct.toFixed(1)}%</td>
                    <td style="padding: 0.75rem 1rem; color: var(--text-secondary); text-align: center; font-size: 0.8rem; white-space: nowrap;">${rec.date}</td>
                `;
                recTbody.appendChild(tr);
            });
        } else {
            recEmptyEl.style.display = 'block';
            recTable.style.display = 'none';
        }
    }

    modal.classList.add('active');
}

// Analyze stock from dashboard card click
async function analyzeStockForDashboard(ticker) {
    if (!ticker) return;

    // Check cache first
    if (expertScreenCache[ticker]) {
        openExpertDetailModal(expertScreenCache[ticker]);
        return;
    }

    const cleanTicker = ticker.toUpperCase();
    const isETF = typeof ETF_DATABASE !== 'undefined' && ETF_DATABASE[cleanTicker] !== undefined;

    if (isETF) {
        const name = ETF_DATABASE[cleanTicker].name;
        showExpertToast('⚡ ETF 분석 중', `${name} (${ticker}) ETF의 지표와 가격 추세를 분석하는 중입니다...`);
        try {
            const historical = await fetchRealData(ticker, '1y', 2);
            if (!historical || !historical.data || historical.data.length < 2) {
                showExpertToast('❌ 분석 실패', `${ticker} ETF 데이터를 로드할 수 없습니다.`);
                return;
            }
            const etfRes = calculateETFScore(cleanTicker, historical);
            expertScreenCache[cleanTicker] = etfRes;
            openExpertDetailModal(etfRes);
            return;
        } catch (e) {
            console.error('Failed to analyze ETF for dashboard:', e);
            showExpertToast('❌ 분석 실패', 'ETF 데이터를 처리하는 중 오류가 발생했습니다.');
            return;
        }
    }

    const koreanName = getKoreanName(ticker, '');
    showExpertToast('⚡ 고수 Pick 분석 중', `${koreanName || ticker} (${ticker}) 종목의 기술적 지표 및 재무 상태를 분석하는 중입니다...`);

    try {
        const historical = await fetchRealData(ticker, '1y', 2);
        if (!historical || !historical.data || historical.data.length < 2) {
            showExpertToast('❌ 분석 실패', `${ticker} 종목의 데이터를 로드할 수 없습니다.`);
            return;
        }

        const data = historical.data;
        const len = data.length;
        const latestCandle = data[len - 1];
        const yesterdayCandle = data[len - 2];
        const close = latestCandle.price;

        // 1. Moving Averages
        const ma5 = getSMA(data, 5);
        const ma20 = getSMA(data, 20);
        const ma60 = getSMA(data, 60);
        const ma120 = getSMA(data, 120);

        // 2. Alignment & Disparity
        let maArrangement = false;
        if (ma5 !== null && ma20 !== null && ma60 !== null && ma120 !== null) {
            maArrangement = (ma5 > ma20) && (ma20 > ma60) && (ma60 > ma120);
        }
        const disparity = ma20 ? (close / ma20) * 100 : 0;
        const isDisparitySafe = disparity <= 110.0;

        // 3. Volume average and current volume
        let volumeSum20 = 0;
        for (let j = len - 21; j < len - 1; j++) {
            if (data[j]) volumeSum20 += data[j].v || 0;
        }
        const avgVolume20 = volumeSum20 / 20;
        const currentVolume = latestCandle.v || 0;
        const volumeSpikeRatio = avgVolume20 > 0 ? (currentVolume / avgVolume20) * 100 : 0;
        const isVolumePop = volumeSpikeRatio >= 500.0;

        // 4. Breakout check
        let highestClose20 = 0;
        for (let j = len - 21; j < len - 1; j++) {
            if (data[j] && data[j].c > highestClose20) {
                highestClose20 = data[j].c;
            }
        }
        const isBreakout = close >= highestClose20;

        // 5. Pivot Points
        const prevHigh = yesterdayCandle.h || yesterdayCandle.c;
        const prevLow = yesterdayCandle.l || yesterdayCandle.c;
        const prevClose = yesterdayCandle.c;
        const pp = (prevHigh + prevLow + prevClose) / 3;
        const r1 = (2 * pp) - prevLow;
        const s1 = (2 * pp) - prevHigh;
        const r2 = pp + (prevHigh - prevLow);
        const s2 = pp - (prevHigh - prevLow);

        // 6. Stop-Losses
        const stoploss3pct = close * 0.97;
        let lowest5 = close;
        for (let j = len - 5; j < len; j++) {
            if (data[j] && data[j].c < lowest5) lowest5 = data[j].c;
        }
        const stoploss5day = lowest5;

        // 7. Fundamental assessment
        const fund = STOCK_FUNDAMENTALS[ticker] || null;
        const isFundStrong = fund ? (fund.opMargin >= 10.0 && fund.revGrowth >= 20.0) : false;

        // Match counts
        const match1 = isVolumePop && isBreakout;
        const match2 = maArrangement && isDisparitySafe;
        const match3 = close >= s1;
        const match4 = isFundStrong;

        let matchCount = 0;
        if (match1) matchCount++;
        if (match2) matchCount++;
        if (match3) matchCount++;
        if (match4) matchCount++;

        const name = getKoreanName(ticker, historical.companyName || ticker);
        const exchange = ticker.endsWith('.KS') ? 'KOSPI' : (ticker.endsWith('.KQ') ? 'KOSDAQ' : 'US');

        const isKRW = ticker.endsWith('.KS') || ticker.endsWith('.KQ');
        const maDetailStr = maArrangement 
            ? `5일:${formatMAValue(ma5, isKRW)} > 20일:${formatMAValue(ma20, isKRW)} > 60일:${formatMAValue(ma60, isKRW)} > 120일:${formatMAValue(ma120, isKRW)}`
            : `5일:${formatMAValue(ma5, isKRW)}, 20일:${formatMAValue(ma20, isKRW)}, 60일:${formatMAValue(ma60, isKRW)}, 120일:${formatMAValue(ma120, isKRW)}`;

        const stockResult = {
            ticker: ticker,
            name: name,
            exchange: exchange,
            price: close,
            prevClose: historical.previousClose || close,
            match1, match2, match3, match4,
            matchCount,
            maArrangement,
            isDisparitySafe,
            detail: {
                maAlignment: maArrangement ? `정배열 진입` : `정배열 아님`,
                ma5, ma20, ma60, ma120,
                disparity: disparity.toFixed(1) + '%',
                disparityVal: disparity,
                volumeRatio: volumeSpikeRatio.toFixed(0) + '%',
                volumeRatioVal: volumeSpikeRatio,
                currentVolume,
                avgVolume20,
                isBreakout: isBreakout ? '돌파 완료' : '돌파 대기',
                highestClose20,
                pivot: { pp, r1, s1, r2, s2 },
                stoploss: { pct: stoploss3pct, low: stoploss5day },
                fund: fund,
                recommendations: getAnalystRecommendations(ticker, close)
            }
        };

        // Save cache
        expertScreenCache[ticker] = stockResult;

        // Open modal
        openExpertDetailModal(stockResult);

    } catch (e) {
        console.error('Failed to analyze dashboard stock:', e);
        showExpertToast('❌ 분석 실패', '종목 데이터를 처리하는 중 오류가 발생했습니다.');
    }
}

window.analyzeStockForDashboard = analyzeStockForDashboard;

// ==========================================
// Portfolio Snapshot Logic
// ==========================================

let inMemorySnapshots = [];
function getSnapshots() {
    return inMemorySnapshots;
}
function saveSnapshotsList(snapshots) {
    inMemorySnapshots = snapshots;
}

function initPortfolioSnapshots() {
    const createBtn = document.getElementById('create-snapshot-btn');
    const viewAllBtn = document.getElementById('view-all-snapshots-btn');
    const closeBtn = document.getElementById('snapshot-modal-close-btn');
    const modal = document.getElementById('snapshot-modal');
    
    if (createBtn) {
        createBtn.addEventListener('click', savePortfolioSnapshot);
    }
    
    if (viewAllBtn) {
        viewAllBtn.addEventListener('click', openSnapshotModal);
    }
    
    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    }
    
    // Initial render of small list
    renderSnapshotList();
}

function formatSnapshotPrice(price, isKrw) {
    if (isKrw) {
        return new Intl.NumberFormat('ko-KR').format(Math.round(price)) + '원';
    } else {
        return '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
    }
}

function savePortfolioSnapshot() {
    const activeItems = portfolio.filter(p => p.quantity > 0);
    if (activeItems.length === 0) {
        alert('스냅샷을 저장할 보유 자산이 없습니다.');
        return;
    }
    
    // Check if any price is loading (0)
    const hasLoading = activeItems.some(item => (currentPortfolioPrices[item.key] || 0) === 0);
    if (hasLoading) {
        alert('실시간 주가를 모두 불러온 후 스냅샷을 저장해 주세요.');
        return;
    }
    
    let totalKrw = 0;
    const snapshotItems = [];
    
    for (const item of activeItems) {
        const price = currentPortfolioPrices[item.key] || 0;
        const isKrw = item.ticker.endsWith('.KS') || item.ticker.endsWith('.KQ') || item.ticker === '^KS11' || item.ticker === '^KQ11';
        const itemTotal = price * item.quantity;
        const itemTotalKrw = isKrw ? itemTotal : itemTotal * exchangeRate;
        totalKrw += itemTotalKrw;
        
        const rawName = indices[item.key] ? indices[item.key].companyName || item.companyName || item.name : item.name;
        const displayCompanyName = getKoreanName(item.ticker, rawName);
        
        snapshotItems.push({
            key: item.key,
            ticker: item.ticker,
            name: displayCompanyName,
            quantity: item.quantity,
            savedPrice: price,
            savedValuationKrw: itemTotalKrw,
            isKrw: isKrw
        });
    }
    
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    
    const snapshot = {
        id: 'snap_' + now.getTime(),
        timestamp: now.getTime(),
        dateStr: dateStr,
        items: snapshotItems,
        exchangeRate: exchangeRate,
        totalKrw: totalKrw
    };
    
    let snapshots = getSnapshots();
    snapshots.unshift(snapshot);
    saveSnapshotsList(snapshots);
    
    renderSnapshotList();
    
    if (typeof showExpertToast === 'function') {
        showExpertToast('📷 스냅샷 저장 완료', '현재 포트폴리오 상태가 저장되었습니다.');
    } else {
        alert('스냅샷이 저장되었습니다!');
    }
}

function renderSnapshotList() {
    const container = document.getElementById('snapshot-list');
    if (!container) return;
    
    const snapshots = getSnapshots();
    if (snapshots.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 1.5rem 0; font-size: 0.8rem;">저장된 스냅샷이 없습니다.</div>`;
        return;
    }
    
    let html = '';
    const pad = (n) => n.toString().padStart(2, '0');
    const displaySnaps = snapshots.slice(0, 5); // display latest 5
    
    displaySnaps.forEach(snap => {
        const date = new Date(snap.timestamp);
        const displayDate = `${pad(date.getMonth()+1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
        const formattedTotal = new Intl.NumberFormat('ko-KR').format(Math.round(snap.totalKrw)) + '원';
        
        html += `
            <div class="snapshot-item" onclick="openSnapshotDetail('${snap.id}')">
                <div class="snapshot-item-left">
                    <span class="snapshot-item-date">📅 ${displayDate}</span>
                    <span class="snapshot-item-count">보유 종목 ${snap.items.length}개</span>
                </div>
                <div class="snapshot-item-right">
                    <span class="snapshot-item-total">${formattedTotal}</span>
                    <button class="snapshot-delete-btn" onclick="event.stopPropagation(); deleteSnapshot('${snap.id}')" title="삭제">&times;</button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

window.deleteSnapshot = function(id) {
    if (!confirm('해당 스냅샷을 삭제하시겠습니까?')) return;
    
    let snapshots = getSnapshots();
    snapshots = snapshots.filter(s => s.id !== id);
    saveSnapshotsList(snapshots);
    
    renderSnapshotList();
    
    // If modal is active, re-render the modal list
    const modal = document.getElementById('snapshot-modal');
    if (modal && modal.classList.contains('active')) {
        renderSnapshotModalList(snapshots);
    }
    
    if (typeof showExpertToast === 'function') {
        showExpertToast('🗑️ 스냅샷 삭제 완료', '선택한 스냅샷이 삭제되었습니다.');
    }
};

window.openSnapshotDetail = function(id) {
    // Open snapshot modal directly
    openSnapshotModal();
    
    // Scroll to the card with the specific id in the modal
    setTimeout(() => {
        const targetCard = document.querySelector(`.snapshot-modal-card[data-id="${id}"]`);
        if (targetCard) {
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Add a temporary highlight effect
            targetCard.style.borderColor = 'var(--neon-purple)';
            targetCard.style.boxShadow = '0 0 15px rgba(139, 92, 246, 0.4)';
            setTimeout(() => {
                targetCard.style.borderColor = '';
                targetCard.style.boxShadow = '';
            }, 2000);
        }
    }, 400);
};

async function openSnapshotModal() {
    const modal = document.getElementById('snapshot-modal');
    if (!modal) return;
    
    const snapshots = getSnapshots();
    const listContainer = document.getElementById('snapshot-modal-list');
    if (!listContainer) return;
    
    if (snapshots.length === 0) {
        listContainer.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 3rem 0; font-size: 0.95rem;">저장된 스냅샷이 없습니다.</div>`;
        modal.classList.add('active');
        return;
    }
    
    // Show spinner while fetching real-time prices
    listContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-secondary); padding: 3rem 0; font-size: 0.95rem;">
            <div style="display: inline-block; width: 30px; height: 30px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--neon-purple); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 12px;"></div>
            <div>스냅샷의 현재 실시간 가치를 계산하는 중...</div>
        </div>
    `;
    modal.classList.add('active');
    
    await prefetchSnapshotCurrentPrices(snapshots);
    renderSnapshotModalList(snapshots);
}

window.openSnapshotModal = openSnapshotModal;

async function prefetchSnapshotCurrentPrices(snapshots) {
    const uniqueKeys = new Set();
    snapshots.forEach(snap => {
        snap.items.forEach(item => {
            uniqueKeys.add(item.key);
        });
    });
    
    // Fetch exchange rate to convert foreign stock prices correctly
    await fetchExchangeRate();
    
    for (const key of uniqueKeys) {
        if (!currentPortfolioPrices[key] || currentPortfolioPrices[key] === 0) {
            // Find ticker from indices or try key (stripped custom_)
            let ticker = key;
            if (indices[key]) {
                ticker = indices[key].ticker;
            } else if (key.startsWith('custom_')) {
                let foundItem = null;
                for (const snap of snapshots) {
                    const match = snap.items.find(item => item.key === key);
                    if (match) {
                        foundItem = match;
                        break;
                    }
                }
                if (foundItem) {
                    ticker = foundItem.ticker;
                } else {
                    ticker = key.substring(7); // fallback
                }
            }
            
            // Try fetching from Yahoo
            const apiResult = await fetchRealData(ticker, '1d', 1);
            if (apiResult && apiResult.data.length > 0) {
                currentPortfolioPrices[key] = apiResult.data[apiResult.data.length - 1].price;
            }
        }
    }
}

function renderSnapshotModalList(snapshots) {
    const listContainer = document.getElementById('snapshot-modal-list');
    if (!listContainer) return;
    
    if (snapshots.length === 0) {
        listContainer.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 3rem 0; font-size: 0.95rem;">저장된 스냅샷이 없습니다.</div>`;
        return;
    }
    
    let html = '';
    
    snapshots.forEach(snap => {
        let currentTotalKrw = 0;
        
        snap.items.forEach(item => {
            const livePrice = currentPortfolioPrices[item.key] || item.savedPrice;
            const itemCurrentTotal = livePrice * item.quantity;
            const itemCurrentTotalKrw = item.isKrw ? itemCurrentTotal : itemCurrentTotal * exchangeRate;
            currentTotalKrw += itemCurrentTotalKrw;
        });
        
        const diffKrw = currentTotalKrw - snap.totalKrw;
        const diffPct = snap.totalKrw > 0 ? (diffKrw / snap.totalKrw) * 100 : 0;
        
        let comparisonBadgeHtml = '';
        if (diffKrw > 0) {
            comparisonBadgeHtml = `<span class="snap-comparison-badge positive">▲ ${new Intl.NumberFormat('ko-KR').format(Math.round(diffKrw))}원 (+${diffPct.toFixed(2)}%)</span>`;
        } else if (diffKrw < 0) {
            comparisonBadgeHtml = `<span class="snap-comparison-badge negative">▼ ${new Intl.NumberFormat('ko-KR').format(Math.round(Math.abs(diffKrw)))}원 (${diffPct.toFixed(2)}%)</span>`;
        } else {
            comparisonBadgeHtml = `<span class="snap-comparison-badge neutral">0원 (0.00%)</span>`;
        }
        
        html += `
            <div class="snapshot-modal-card" data-id="${snap.id}">
                <div class="snapshot-card-header">
                    <span class="snapshot-card-title">📅 ${snap.dateStr}</span>
                    <button class="glass-btn" style="padding: 0.35rem 0.75rem; font-size: 0.75rem; border-color: rgba(239, 68, 68, 0.4); color: var(--negative); font-weight: 700;" onclick="deleteSnapshot('${snap.id}')">삭제</button>
                </div>
                
                <div class="snapshot-card-valuation-grid">
                    <div class="snapshot-val-box">
                        <span class="snapshot-val-label">저장 당시 총 평가금액 (SAVED TOTAL)</span>
                        <span class="snapshot-val-value saved">${new Intl.NumberFormat('ko-KR').format(Math.round(snap.totalKrw))}원</span>
                    </div>
                    <div class="snapshot-val-box">
                        <span class="snapshot-val-label">현재 기준 총 평가금액 (CURRENT TOTAL)</span>
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            <span class="snapshot-val-value current">${new Intl.NumberFormat('ko-KR').format(Math.round(currentTotalKrw))}원</span>
                            ${comparisonBadgeHtml}
                        </div>
                    </div>
                </div>
                
                <div class="snapshot-table-container">
                    <table class="snapshot-table">
                        <thead>
                            <tr>
                                <th>종목명 (티커)</th>
                                <th>보유수량</th>
                                <th>저장 가격</th>
                                <th>현재 가격</th>
                                <th>저장 평가금액</th>
                                <th>현재 평가금액</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${snap.items.map(item => {
                                const livePrice = currentPortfolioPrices[item.key] || item.savedPrice;
                                const savedVal = item.savedValuationKrw;
                                const liveVal = item.isKrw ? livePrice * item.quantity : livePrice * item.quantity * exchangeRate;
                                return `
                                    <tr>
                                        <td><strong>${item.name}</strong> <span style="font-size: 0.7rem; color: var(--text-secondary);">${item.ticker}</span></td>
                                        <td>${item.quantity}주</td>
                                        <td>${formatSnapshotPrice(item.savedPrice, item.isKrw)}</td>
                                        <td>${formatSnapshotPrice(livePrice, item.isKrw)}</td>
                                        <td>${new Intl.NumberFormat('ko-KR').format(Math.round(savedVal))}원</td>
                                        <td>${new Intl.NumberFormat('ko-KR').format(Math.round(liveVal))}원</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });
    
    listContainer.innerHTML = html;
}


