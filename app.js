const STORAGE_KEY = "stock-portfolio-v1";

const form = document.querySelector("#stockForm");
const installButton = document.querySelector("#installButton");
const rows = {
  KR: document.querySelector("#krRows"),
  US: document.querySelector("#usRows"),
};
const counts = {
  KR: document.querySelector("#krCount"),
  US: document.querySelector("#usCount"),
};

let deferredInstallPrompt = null;
let portfolio = loadPortfolio();

const formatters = {
  KR: new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }),
  US: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }),
};

const numberFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 4,
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const stock = {
    id: crypto.randomUUID(),
    market: document.querySelector("#market").value,
    name: document.querySelector("#name").value.trim(),
    ticker: document.querySelector("#ticker").value.trim().toUpperCase(),
    quantity: Number(document.querySelector("#quantity").value),
    avgPrice: Number(document.querySelector("#avgPrice").value),
    currentPrice: Number(document.querySelector("#currentPrice").value),
  };

  portfolio.push(stock);
  savePortfolio();
  render();
  form.reset();
  document.querySelector("#market").value = stock.market;
  document.querySelector("#name").focus();
});

document.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-id]");
  if (!deleteButton) return;

  portfolio = portfolio.filter((stock) => stock.id !== deleteButton.dataset.deleteId);
  savePortfolio();
  render();
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
    navigator.serviceWorker.register("service-worker.js");
  });
}

render();

function render() {
  renderMarket("KR");
  renderMarket("US");
  renderSummary();
}

function renderMarket(market) {
  const marketStocks = portfolio.filter((stock) => stock.market === market);
  counts[market].textContent = `${marketStocks.length}개`;

  if (marketStocks.length === 0) {
    rows[market].innerHTML = `<tr class="empty-row"><td colspan="8">등록된 종목이 없습니다.</td></tr>`;
    return;
  }

  rows[market].innerHTML = marketStocks
    .map((stock) => {
      const cost = stock.quantity * stock.avgPrice;
      const value = stock.quantity * stock.currentPrice;
      const profit = value - cost;
      const profitClass = profit >= 0 ? "gain" : "loss";

      return `
        <tr>
          <td>${escapeHtml(stock.name)}</td>
          <td>${escapeHtml(stock.ticker)}</td>
          <td>${numberFormatter.format(stock.quantity)}</td>
          <td>${formatMoney(market, stock.avgPrice)}</td>
          <td>${formatMoney(market, stock.currentPrice)}</td>
          <td>${formatMoney(market, value)}</td>
          <td class="${profitClass}">${formatMoney(market, profit)}</td>
          <td><button class="row-action" type="button" data-delete-id="${stock.id}">삭제</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderSummary() {
  const krSummary = summarizeMarket("KR");
  const usSummary = summarizeMarket("US");

  document.querySelector("#krValue").textContent = formatters.KR.format(krSummary.value);
  document.querySelector("#krProfit").textContent = formatters.KR.format(krSummary.profit);
  document.querySelector("#krProfit").className = krSummary.profit >= 0 ? "gain" : "loss";
  document.querySelector("#usValue").textContent = formatters.US.format(usSummary.value);
  document.querySelector("#usProfit").textContent = formatters.US.format(usSummary.profit);
  document.querySelector("#usProfit").className = usSummary.profit >= 0 ? "gain" : "loss";
}

function summarizeMarket(market) {
  const summary = portfolio
    .filter((stock) => stock.market === market)
    .reduce(
      (acc, stock) => {
        const cost = stock.quantity * stock.avgPrice;
        const value = stock.quantity * stock.currentPrice;
        acc.cost += cost;
        acc.value += value;
        return acc;
      },
      { cost: 0, value: 0 },
    );

  return {
    ...summary,
    profit: summary.value - summary.cost,
  };
}

function formatMoney(market, amount) {
  return formatters[market].format(amount);
}

function loadPortfolio() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function savePortfolio() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
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
