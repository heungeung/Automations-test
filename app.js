const RECENT_KEY = "kr-stock-research-recent-v1";
const HOLDING_THRESHOLD = 10;

const lookupForm = document.querySelector("#lookupForm");
const symbolInput = document.querySelector("#symbolInput");
const nameInput = document.querySelector("#nameInput");
const statusText = document.querySelector("#statusText");
const installButton = document.querySelector("#installButton");
const chartCanvas = document.querySelector("#priceChart");
const chartButtons = document.querySelectorAll("[data-range]");
const recentRows = document.querySelector("#recentRows");

let activeRange = "1d";
let activeStock = null;
let activeChartData = [];
let etfHoldings = [];
let deferredInstallPrompt = null;
let recentLookups = loadRecentLookups();

const wonFormatter = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("ko-KR");
const percentFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await lookupStock(symbolInput.value, nameInput.value);
});

chartButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    chartButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeRange = button.dataset.range;
    if (activeStock) {
      await lookupStock(activeStock.inputSymbol, activeStock.inputName, { remember: false });
    }
  });
});

document.addEventListener("click", async (event) => {
  const lookupButton = event.target.closest("[data-lookup-symbol]");
  if (!lookupButton) return;
  await lookupStock(lookupButton.dataset.lookupSymbol, lookupButton.dataset.lookupName ?? "");
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").then((registration) => {
      registration.update();
    });
  });
}

init();

async function init() {
  renderRecentLookups();
  drawEmptyChart("종목을 조회하면 차트가 표시됩니다.");
  try {
    const response = await fetch("etf-holdings-kr.json", { cache: "no-store" });
    etfHoldings = await response.json();
  } catch {
    etfHoldings = [];
  }
}

async function lookupStock(rawSymbol, rawName, options = { remember: true }) {
  const inputSymbol = normalizeSymbol(rawSymbol);
  const inputName = rawName.trim();

  if (!/^\d{6}$/.test(inputSymbol)) {
    setStatus("한국 종목코드 6자리를 입력하세요.", "error");
    return;
  }

  symbolInput.value = inputSymbol;
  nameInput.value = inputName;
  setStatus(`${inputSymbol} 데이터를 불러오는 중입니다.`, "loading");

  try {
    const result = await fetchKoreanStock(inputSymbol, activeRange);
    activeStock = { ...result, inputSymbol, inputName };
    activeChartData = result.points;

    renderQuote(result, inputName);
    renderChart(result.points);
    renderEtfs(inputSymbol);

    if (options.remember) {
      rememberLookup(activeStock, inputName);
    }

    setStatus(`${result.symbol} 기준 데이터를 불러왔습니다.`, "success");
  } catch (error) {
    activeStock = null;
    activeChartData = [];
    clearQuote();
    drawEmptyChart("시세 데이터를 가져오지 못했습니다.");
    renderEtfs(inputSymbol);
    setStatus(error.message, "error");
  }
}

async function fetchKoreanStock(symbol, rangeKey) {
  const config = {
    "1d": { range: "6mo", interval: "1d" },
    "1wk": { range: "2y", interval: "1wk" },
    "1mo": { range: "5y", interval: "1mo" },
  }[rangeKey];

  const candidates = [`${symbol}.KS`, `${symbol}.KQ`];
  const errors = [];

  for (const yahooSymbol of candidates) {
    try {
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        yahooSymbol,
      )}?range=${config.range}&interval=${config.interval}`;
      const payload = await fetchYahooJson(yahooUrl);
      const parsed = parseYahooChart(payload);
      if (parsed.points.length > 0) {
        return { ...parsed, symbol: yahooSymbol };
      }
    } catch (error) {
      errors.push(`${yahooSymbol}: ${error.message}`);
    }
  }

  throw new Error(`시세 조회에 실패했습니다. 종목코드 또는 네트워크/CORS 상태를 확인하세요. (${errors.join(", ")})`);
}

async function fetchYahooJson(yahooUrl) {
  const urls = [
    yahooUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`,
  ];
  const errors = [];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors.join(" / "));
}

function parseYahooChart(payload) {
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const meta = result?.meta;
  if (!result || !quote || !meta) {
    throw new Error("응답 형식이 올바르지 않습니다.");
  }

  const timestamps = result.timestamp ?? [];
  const points = timestamps
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000),
      open: quote.open?.[index],
      high: quote.high?.[index],
      low: quote.low?.[index],
      close: quote.close?.[index],
      volume: quote.volume?.[index],
    }))
    .filter((point) => Number.isFinite(point.close));

  const latest = points.at(-1);
  const previous = points.at(-2);
  const change = latest && previous ? latest.close - previous.close : 0;
  const changeRate = previous?.close ? (change / previous.close) * 100 : 0;

  return {
    exchangeName: meta.exchangeName ?? "-",
    currency: meta.currency ?? "KRW",
    regularMarketPrice: meta.regularMarketPrice ?? latest?.close ?? 0,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    latest,
    change,
    changeRate,
    points,
  };
}

function renderQuote(stock, inputName) {
  const displayName = inputName || stock.symbol;
  document.querySelector("#quoteName").textContent = `${displayName} · ${stock.symbol}`;
  document.querySelector("#currentPrice").textContent = wonFormatter.format(stock.regularMarketPrice);
  document.querySelector("#priceChange").textContent = `${wonFormatter.format(stock.change)} (${percentFormatter.format(
    stock.changeRate,
  )}%)`;
  document.querySelector("#priceChange").className = stock.change >= 0 ? "gain" : "loss";
  document.querySelector("#volume").textContent = stock.latest?.volume ? numberFormatter.format(stock.latest.volume) : "-";
  document.querySelector("#tradeDate").textContent = stock.latest?.date ? dateFormatter.format(stock.latest.date) : "-";
  document.querySelector("#yahooSymbol").textContent = stock.symbol;
  document.querySelector("#exchangeName").textContent = stock.exchangeName;
  document.querySelector("#currency").textContent = stock.currency;
  document.querySelector("#yearRange").textContent =
    Number.isFinite(stock.fiftyTwoWeekLow) && Number.isFinite(stock.fiftyTwoWeekHigh)
      ? `${wonFormatter.format(stock.fiftyTwoWeekLow)} ~ ${wonFormatter.format(stock.fiftyTwoWeekHigh)}`
      : "-";
}

function clearQuote() {
  document.querySelector("#quoteName").textContent = "종목을 조회하면 표시됩니다.";
  document.querySelector("#currentPrice").textContent = "-";
  document.querySelector("#priceChange").textContent = "-";
  document.querySelector("#priceChange").className = "";
  document.querySelector("#volume").textContent = "-";
  document.querySelector("#tradeDate").textContent = "-";
  document.querySelector("#yahooSymbol").textContent = "-";
  document.querySelector("#exchangeName").textContent = "-";
  document.querySelector("#currency").textContent = "-";
  document.querySelector("#yearRange").textContent = "-";
}

function renderEtfs(symbol) {
  const isKnownEtf = etfHoldings.some((etf) => etf.symbol === symbol);
  if (isKnownEtf) {
    document.querySelector("#etfCount").textContent = "해당 없음";
    document.querySelector("#etfList").innerHTML = `
      <p class="empty-state">입력한 코드는 내장 데이터셋 기준 ETF로 분류됩니다.</p>
      <p class="data-note">10% 이상 보유 ETF 조회는 개별 주식 종목을 대상으로 표시합니다.</p>
    `;
    return;
  }

  const matches = etfHoldings
    .filter((etf) => etf.holdings.some((holding) => holding.symbol === symbol && holding.weight >= HOLDING_THRESHOLD))
    .map((etf) => ({
      ...etf,
      matchedHolding: etf.holdings.find((holding) => holding.symbol === symbol),
    }))
    .sort((a, b) => b.matchedHolding.weight - a.matchedHolding.weight);

  document.querySelector("#etfCount").textContent = `${matches.length}개`;
  const target = document.querySelector("#etfList");

  if (matches.length === 0) {
    target.innerHTML = `
      <p class="empty-state">내장 ETF 데이터에서 10% 이상 편입 ETF를 찾지 못했습니다.</p>
      <p class="data-note">ETF 편입 비중은 운용사 공시 기준으로 자주 바뀌므로 <code>etf-holdings-kr.json</code> 데이터를 갱신해 사용하세요.</p>
    `;
    return;
  }

  target.innerHTML = matches
    .map(
      (etf) => `
        <article class="etf-item">
          <div>
            <strong>${escapeHtml(etf.name)}</strong>
            <span>${escapeHtml(etf.symbol)} · ${escapeHtml(etf.provider)}</span>
          </div>
          <b>${percentFormatter.format(etf.matchedHolding.weight)}%</b>
          <small>기준일 ${escapeHtml(etf.asOf)}</small>
        </article>
      `,
    )
    .join("");
}

function renderChart(points) {
  if (points.length < 2) {
    drawEmptyChart("표시할 차트 데이터가 부족합니다.");
    return;
  }

  const context = chartCanvas.getContext("2d");
  const rect = chartCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  chartCanvas.width = Math.round(rect.width * ratio);
  chartCanvas.height = Math.round(rect.height * ratio);
  context.scale(ratio, ratio);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 26, right: 18, bottom: 34, left: 64 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const closes = points.map((point) => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#dbe5e1";
  context.lineWidth = 1;
  context.fillStyle = "#62706c";
  context.font = "12px Segoe UI";

  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (chartHeight / 4) * index;
    const value = max - (range / 4) * index;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(wonFormatter.format(value), 8, y + 4);
  }

  context.beginPath();
  points.forEach((point, index) => {
    const x = padding.left + (chartWidth / (points.length - 1)) * index;
    const y = padding.top + chartHeight - ((point.close - min) / range) * chartHeight;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = points.at(-1).close >= points[0].close ? "#b42318" : "#2563eb";
  context.lineWidth = 2.5;
  context.stroke();

  context.fillStyle = "#62706c";
  context.fillText(dateFormatter.format(points[0].date), padding.left, height - 12);
  context.textAlign = "right";
  context.fillText(dateFormatter.format(points.at(-1).date), width - padding.right, height - 12);
  context.textAlign = "left";
}

function drawEmptyChart(message) {
  const context = chartCanvas.getContext("2d");
  const rect = chartCanvas.getBoundingClientRect();
  chartCanvas.width = Math.round(rect.width || 1080);
  chartCanvas.height = Math.round(rect.height || 420);
  context.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, chartCanvas.width, chartCanvas.height);
  context.fillStyle = "#62706c";
  context.font = "16px Segoe UI";
  context.textAlign = "center";
  context.fillText(message, chartCanvas.width / 2, chartCanvas.height / 2);
  context.textAlign = "left";
}

function rememberLookup(stock, inputName) {
  const record = {
    symbol: stock.inputSymbol,
    name: inputName || stock.symbol,
    price: stock.regularMarketPrice,
    checkedAt: new Date().toISOString(),
  };

  recentLookups = [record, ...recentLookups.filter((item) => item.symbol !== record.symbol)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recentLookups));
  renderRecentLookups();
}

function renderRecentLookups() {
  document.querySelector("#recentCount").textContent = `${recentLookups.length}개`;
  if (recentLookups.length === 0) {
    recentRows.innerHTML = `<tr class="empty-row"><td colspan="5">최근 조회한 종목이 없습니다.</td></tr>`;
    return;
  }

  recentRows.innerHTML = recentLookups
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.symbol)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${wonFormatter.format(item.price)}</td>
          <td>${dateTimeFormatter.format(new Date(item.checkedAt))}</td>
          <td><button class="row-action" type="button" data-lookup-symbol="${escapeHtml(
            item.symbol,
          )}" data-lookup-name="${escapeHtml(item.name)}">조회</button></td>
        </tr>
      `,
    )
    .join("");
}

function loadRecentLookups() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) ?? [];
  } catch {
    return [];
  }
}

function setStatus(message, type) {
  statusText.textContent = message;
  statusText.dataset.type = type;
}

function normalizeSymbol(value) {
  return value.replace(/\D/g, "").slice(0, 6);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

window.addEventListener("resize", () => {
  if (activeChartData.length > 0) {
    renderChart(activeChartData);
  }
});
