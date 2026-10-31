(() => {
  'use strict';

  const STORAGE_KEY = 'monitor-financas.v1';
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const DEFAULT_EXPENSE = [
    ['Alimentação', '#f97316'],
    ['Transporte', '#3b82f6'],
    ['Moradia', '#8b5cf6'],
    ['Saúde', '#ef4444'],
    ['Lazer', '#ec4899'],
    ['Educação', '#14b8a6'],
    ['Compras', '#f59e0b'],
    ['Contas', '#64748b'],
    ['Cartão de crédito', '#0f766e'],
    ['Outros', '#94a3b8'],
  ];

  const DEFAULT_INCOME = [
    ['Salário', '#10b981'],
    ['Freelance', '#22c55e'],
    ['Investimentos', '#0ea5e9'],
    ['Presente', '#a855f7'],
    ['Outros', '#94a3b8'],
  ];

  const PALETTE = ['#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#ec4899', '#f59e0b', '#14b8a6', '#0ea5e9', '#f97316', '#64748b'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const brl = (v) => BRL.format(Number(v) || 0);
  const uid = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let state = load();
  let viewDate = currentMonth();
  let filterType = 'all';
  let editingId = null;
  let formType = 'expense';
  let toastTimer = null;

  function currentMonth() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function defaultState() {
    return {
      version: 1,
      transactions: [],
      groups: [],
      budgets: {},
      categories: {
        expense: DEFAULT_EXPENSE.map(([name, color]) => ({ name, color })),
        income: DEFAULT_INCOME.map(([name, color]) => ({ name, color })),
      },
    };
  }

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    const tx = Array.isArray(raw.transactions)
      ? raw.transactions
          .filter((t) => t && typeof t === 'object' && t.id && t.date && t.category)
          .map((t) => ({
            id: String(t.id),
            type: t.type === 'income' ? 'income' : 'expense',
            amount: Number(t.amount) || 0,
            category: String(t.category),
            date: String(t.date).slice(0, 10),
            note: typeof t.note === 'string' ? t.note : '',
            createdAt: Number(t.createdAt) || 0,
            ...(t.groupId ? { groupId: String(t.groupId) } : {}),
            ...(t.groupType ? { groupType: String(t.groupType) } : {}),
            ...(t.invoice ? { invoice: true } : {}),
            ...(typeof t.card === 'string' ? { card: t.card } : {}),
            ...(isFinite(Number(t.part)) && t.part ? { part: Number(t.part) } : {}),
            ...(isFinite(Number(t.parts)) && t.parts ? { parts: Number(t.parts) } : {}),
          }))
      : [];
    const budgets = {};
    if (raw.budgets && typeof raw.budgets === 'object') {
      for (const [k, v] of Object.entries(raw.budgets)) {
        const n = Number(v);
        if (isFinite(n) && n > 0) budgets[String(k)] = n;
      }
    }
    const cats = { expense: [], income: [] };
    for (const kind of ['expense', 'income']) {
      const list = raw.categories && Array.isArray(raw.categories[kind]) ? raw.categories[kind] : null;
      if (list && list.length) {
        const seen = new Set();
        for (const c of list) {
          const name = typeof c === 'string' ? c : c && c.name;
          if (!name || seen.has(String(name))) continue;
          seen.add(String(name));
          cats[kind].push({ name: String(name), color: (c && c.color) || '#94a3b8' });
        }
      }
      if (!cats[kind].length) cats[kind] = base.categories[kind];
    }
    const groups = Array.isArray(raw.groups)
      ? raw.groups
          .filter((g) => g && typeof g === 'object' && g.id && g.label)
          .map((g) => ({
            id: String(g.id),
            type: g.type === 'invoice' ? 'invoice' : 'installment',
            label: String(g.label),
            card: typeof g.card === 'string' ? g.card : '',
            category: typeof g.category === 'string' ? g.category : 'Outros',
            startDate: String(g.startDate || '').slice(0, 10),
            createdAt: Number(g.createdAt) || 0,
          }))
      : [];
    const invoiceGroups = new Map(groups.filter((g) => g.type === 'invoice').map((g) => [g.id, g]));
    if (invoiceGroups.size) {
      tx.forEach((t) => {
        if (t.groupId && invoiceGroups.has(t.groupId)) {
          t.invoice = true;
          t.card = invoiceGroups.get(t.groupId).label;
        }
      });
    }
    const keptGroups = groups.filter((g) => g.type !== 'invoice');
    return { version: 1, transactions: tx, groups: keptGroups, budgets, categories: cats };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (err) {
      console.warn('Falha ao carregar dados', err);
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error(err);
      toast('Não foi possível salvar os dados');
    }
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function parseISO(str) {
    const [y, m, d] = String(str).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function parseAmount(value) {
    if (typeof value === 'number') return value;
    let s = String(value ?? '').replace(/[^\d.,-]/g, '').trim();
    if (!s) return NaN;
    const negative = s.startsWith('-');
    s = s.replace(/-/g, '');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > -1) {
      const parts = s.split('.');
      if (parts.length > 2) s = parts.join('');
      else if (parts.length === 2 && parts[1].length === 3) s = parts.join('');
    }
    const n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    return negative ? -n : n;
  }

  function formatAmountInput(v) {
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function findCat(name, kind) {
    const list = state.categories[kind] || [];
    return list.find((c) => c.name === name) || { name, color: '#94a3b8' };
  }

  function monthTransactions() {
    const key = monthKey(viewDate);
    return state.transactions.filter((t) => t.date && t.date.slice(0, 7) === key);
  }

  function sumBy(list, type) {
    return list.filter((t) => t.type === type).reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  }

  function sortTx(list) {
    return [...list].sort(
      (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.createdAt || 0) - (a.createdAt || 0)
    );
  }

  function totalBudget() {
    return state.categories.expense.reduce((acc, c) => acc + (Number(state.budgets[c.name]) || 0), 0);
  }

  function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
  }

  /* ---------------- Render ---------------- */

  function render() {
    $('#monthLabel').textContent = capitalize(
      viewDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    );
    $('#heroMonth').textContent = viewDate.toLocaleDateString('pt-BR', { month: 'long' });
    renderResumo();
    renderLancamentos();
    renderOrcamento();
    renderPrevisao();
  }

  function renderResumo() {
    const tx = monthTransactions();
    const expense = sumBy(tx, 'expense');
    const income = sumBy(tx, 'income');
    const saldo = income - expense;
    const today = todayISO();
    const isFutureMonth = monthKey(viewDate) > monthKey(currentMonth());
    const futureExpense = tx
      .filter((t) => t.type === 'expense' && t.date > today)
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    $('#heroVerb').textContent = isFutureMonth ? 'Previsto' : 'Gasto';
    const futureEl = $('#heroFuture');
    if (!isFutureMonth && futureExpense > 0) {
      futureEl.textContent = `Inclui ${brl(futureExpense)} em lançamentos previstos`;
      futureEl.classList.remove('hidden');
    } else {
      futureEl.classList.add('hidden');
    }

    $('#resumoTotal').textContent = brl(expense);
    $('#resumoReceitas').textContent = brl(income);
    const saldoEl = $('#resumoSaldo');
    saldoEl.textContent = brl(saldo);
    saldoEl.classList.toggle('pos', saldo >= 0);
    saldoEl.classList.toggle('neg', saldo < 0);

    const budget = totalBudget();
    const card = $('#budgetCard');
    const budgetBar = $('#budgetBar');

    if (budget > 0) {
      card.classList.remove('hidden');
      const pct = Math.round((expense / budget) * 100);
      $('#budgetPct').textContent = pct + '%';
      budgetBar.style.width = Math.min(pct, 100) + '%';
      budgetBar.classList.toggle('over', expense > budget);
      $('#budgetText').textContent =
        expense <= budget
          ? `${brl(expense)} de ${brl(budget)} · restam ${brl(budget - expense)}`
          : `${brl(expense)} de ${brl(budget)} · excedeu ${brl(expense - budget)}`;
    } else {
      card.classList.add('hidden');
    }

    const byCat = new Map();
    tx.filter((t) => t.type === 'expense').forEach((t) => {
      byCat.set(t.category, (byCat.get(t.category) || 0) + (Number(t.amount) || 0));
    });
    const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 0;

    $('#resumoCategorias').innerHTML = rows.length
      ? rows
          .map(([name, value]) => {
            const cat = findCat(name, 'expense');
            const share = expense ? Math.round((value / expense) * 100) : 0;
            return `<div class="catrow">
              <div class="catrow-head">
                <span class="dot" style="background:${esc(cat.color)}"></span>
                <span class="catname">${esc(name)}</span>
                <span class="catval">${brl(value)}</span>
              </div>
              <div class="bar thin"><span style="width:${max ? (value / max) * 100 : 0}%;background:${esc(cat.color)}"></span></div>
              <span class="muted small" style="display:block;margin-top:5px">${share}% dos gastos</span>
            </div>`;
          })
          .join('')
      : '<p class="empty">Nenhum gasto neste mês.</p>';

    const recent = sortTx(tx).slice(0, 5);
    $('#resumoRecentes').innerHTML = recent.length
      ? recent.map(txRowHTML).join('')
      : '<p class="empty">Nada lançado neste mês. Toque em + para começar.</p>';
  }

  function renderLancamentos() {
    const tx = sortTx(monthTransactions().filter((t) => filterType === 'all' || t.type === filterType));
    $('#lancList').innerHTML = tx.length
      ? tx.map(txRowHTML).join('')
      : '<p class="empty">Nenhum lançamento encontrado.</p>';
  }

  function renderOrcamento() {
    const tx = monthTransactions();
    const expense = sumBy(tx, 'expense');
    const budget = totalBudget();
    const pct = budget ? Math.round((expense / budget) * 100) : 0;

    $('#orcTotal').textContent = brl(expense);
    $('#orcPct').textContent = budget ? pct + '%' : '';
    const bar = $('#orcBar');
    bar.style.width = budget ? Math.min(pct, 100) + '%' : '0%';
    bar.classList.toggle('over', !!budget && expense > budget);
    $('#orcText').textContent = budget
      ? expense <= budget
        ? `Orçamento de ${brl(budget)} · restam ${brl(budget - expense)}`
        : `Orçamento de ${brl(budget)} · excedeu ${brl(expense - budget)}`
      : 'Defina um orçamento por categoria abaixo.';

    $('#orcList').innerHTML = state.categories.expense
      .map((c) => {
        const spent = tx
          .filter((t) => t.type === 'expense' && t.category === c.name)
          .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        const catBudget = Number(state.budgets[c.name]) || 0;
        const rowPct = catBudget ? Math.min(Math.round((spent / catBudget) * 100), 100) : 0;
        const over = catBudget > 0 && spent > catBudget;
        return `<div class="orcrow" data-cat="${esc(c.name)}">
          <div class="orcrow-head">
            <span class="dot" style="background:${esc(c.color)}"></span>
            <span class="catname">${esc(c.name)}</span>
            <span class="orc-amount muted small">${
              catBudget ? `${brl(spent)} / ${brl(catBudget)}` : brl(spent)
            }</span>
            <input class="budget-input" data-budget="${esc(c.name)}" inputmode="decimal" autocomplete="off"
              placeholder="—" aria-label="Orçamento de ${esc(c.name)}"
              value="${catBudget ? formatAmountInput(catBudget) : ''}">
          </div>
          <div class="bar thin"><span class="${over ? 'over' : ''}" style="width:${rowPct}%;${
          over ? '' : `background:${esc(c.color)}`
        }"></span></div>
        </div>`;
      })
      .join('');
  }

  function realizedBalance() {
    const today = todayISO();
    return state.transactions.reduce((acc, t) => {
      if (t.date > today) return acc;
      return acc + (t.type === 'income' ? Number(t.amount) || 0 : -(Number(t.amount) || 0));
    }, 0);
  }

  function renderPrevisao() {
    const today = todayISO();
    const balance = realizedBalance();
    const saldoEl = $('#prevSaldo');
    saldoEl.textContent = brl(balance);
    saldoEl.classList.toggle('pos', balance >= 0);
    saldoEl.classList.toggle('neg', balance < 0);
    $('#prevSaldoHint').textContent = state.transactions.length
      ? 'Soma de todas as receitas menos despesas com data até hoje.'
      : 'Cadastre receitas e despesas para acompanhar o saldo.';

    const start = currentMonth();
    let cumulative = balance;
    const rows = [];
    for (let i = 0; i < 6; i++) {
      const month = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const key = monthKey(month);
      const future = state.transactions.filter((t) => t.date.slice(0, 7) === key && t.date > today);
      const income = sumBy(future, 'income');
      const expense = sumBy(future, 'expense');
      const net = income - expense;
      cumulative += net;
      const label =
        i === 0
          ? `Resto de ${month.toLocaleDateString('pt-BR', { month: 'long' })}`
          : capitalize(month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
      rows.push(`<div class="prevrow">
        <div class="prevrow-head">
          <span class="catname">${esc(label)}</span>
          <span class="catval ${net >= 0 ? 'pos' : 'neg'}">${brl(net)}</span>
        </div>
        <div class="prevrow-sub">
          <span class="pos">+ ${brl(income)}</span>
          <span class="neg">− ${brl(expense)}</span>
          <span class="muted small ${cumulative < 0 ? 'neg' : ''}">acumulado ${brl(cumulative)}</span>
        </div>
      </div>`);
    }
    $('#prevMonths').innerHTML = rows.join('');

    const futureTx = state.transactions
      .filter((t) => t.date > today)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
    $('#prevList').innerHTML = futureTx.length
      ? futureTx.map(txRowHTML).join('')
      : '<p class="empty">Nenhum lançamento futuro. Programe contas e receitas para montar a previsão.</p>';

    renderLongTerm();
  }

  function renderLongTerm() {
    const today = todayISO();
    const limit = isoFromDate(addPeriod(new Date(), 'monthly', 12));

    const installments = (state.groups || [])
      .filter((group) => group.type !== 'invoice')
      .map((group) => {
        const txs = state.transactions.filter((t) => t.groupId === group.id);
        const remaining = txs
          .filter((t) => t.date > today)
          .sort((a, b) => a.date.localeCompare(b.date));
        const paid = txs.length - remaining.length;
        return { group, txs, remaining, paid };
      })
      .filter((item) => item.remaining.length > 0);

    const invoices = state.transactions
      .filter((t) => t.invoice && t.date > today && t.date <= limit)
      .sort((a, b) => a.date.localeCompare(b.date));

    let total = 0;
    installments.forEach((item) => {
      item.remaining.forEach((t) => {
        if (t.date <= limit) total += Number(t.amount) || 0;
      });
    });
    invoices.forEach((t) => {
      total += Number(t.amount) || 0;
    });
    $('#ltTotal').textContent = total > 0 ? `restante ${brl(total)}` : '';

    const parts = [];

    if (installments.length) {
      parts.push('<h3 class="lt-sub">Parcelamentos</h3>');
      parts.push(
        installments
          .map((item) => {
            const { group, txs, remaining, paid } = item;
            const cat = findCat(group.category, 'expense');
            const remainingTotal = remaining.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
            const average = remaining.length ? remainingTotal / remaining.length : 0;
            const card = group.card ? ` · ${group.card}` : '';
            const pct = txs.length ? Math.round((paid / txs.length) * 100) : 0;
            return `<div class="ltrow">
              <div class="ltrow-head">
                <span class="dot" style="background:${esc(cat.color)}"></span>
                <div class="lt-main">
                  <span class="tx-title">${esc(group.label)}</span>
                  <span class="tx-sub">Parcelado${esc(card)} · ${paid} de ${txs.length} pagas · ${brl(
              average
            )}/mês</span>
                </div>
                <span class="catval">${brl(remainingTotal)}</span>
                <button type="button" class="tx-del" data-delgroup="${esc(group.id)}" aria-label="Excluir parcelamento">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>
                </button>
              </div>
              <div class="bar thin"><span style="width:${pct}%;background:${esc(cat.color)}"></span></div>
            </div>`;
          })
          .join('')
      );
    }

    if (invoices.length) {
      parts.push('<h3 class="lt-sub">Faturas por mês</h3>');
      parts.push(
        invoices
          .map((t) => {
            const cat = findCat(t.category, 'expense');
            const date = parseISO(t.date);
            const monthLabel = capitalize(
              date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
            );
            const card = t.card || t.note || 'Cartão';
            return `<div class="ltrow" data-invoice="${esc(t.id)}" role="button" tabindex="0">
              <div class="ltrow-head">
                <span class="dot" style="background:${esc(cat.color)}"></span>
                <div class="lt-main">
                  <span class="tx-title">Fatura ${esc(card)}</span>
                  <span class="tx-sub">${esc(monthLabel)} · vence ${date.toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
            })}</span>
                </div>
                <span class="catval">${brl(t.amount)}</span>
                <button type="button" class="tx-del" data-delinvoice="${esc(t.id)}" aria-label="Excluir fatura">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>
                </button>
              </div>
            </div>`;
          })
          .join('')
      );
    }

    $('#ltGroups').innerHTML = parts.length
      ? parts.join('')
      : '<p class="empty">Nenhuma compra parcelada ou fatura em aberto.</p>';
  }

  function ensureCategory(name, kind, color) {
    if (!name) return;
    if (state.categories[kind].some((c) => c.name === name)) return;
    state.categories[kind].push({ name, color: color || '#94a3b8' });
    save();
    renderSettingsCategories();
  }

  function isoFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function addPeriod(base, mode, step) {
    const year = base.getFullYear();
    const month = base.getMonth();
    const day = base.getDate();
    if (mode === 'weekly') {
      const next = new Date(year, month, day);
      next.setDate(next.getDate() + 7 * step);
      return next;
    }
    const monthsToAdd = mode === 'yearly' ? 12 * step : step;
    const target = new Date(year, month + monthsToAdd, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return new Date(target.getFullYear(), target.getMonth(), Math.min(day, lastDay));
  }

  function nextMonthFirstISO() {
    const d = currentMonth();
    return isoFromDate(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  function txRowHTML(t) {
    const isExpense = t.type === 'expense';
    const cat = findCat(t.category, isExpense ? 'expense' : 'income');
    const date = parseISO(t.date);
    const sign = isExpense ? '−' : '+';
    const planned = t.date > todayISO();
    return `<div class="tx" data-id="${esc(t.id)}" role="button" tabindex="0">
      <span class="tx-dot" style="background:${esc(cat.color)}"></span>
      <div class="tx-main">
        <span class="tx-title">${esc(t.note || t.category)}</span>
        <span class="tx-sub">${esc(t.category)} · ${date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    })}${planned ? ' <span class="badge">previsto</span>' : ''}</span>
      </div>
      <span class="tx-amount ${isExpense ? 'exp' : 'inc'}">${sign} ${brl(t.amount)}</span>
      <button type="button" class="tx-del" data-del="${esc(t.id)}" aria-label="Excluir lançamento">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>
      </button>
    </div>`;
  }

  function renderSettingsCategories() {
    const chips = [];
    for (const kind of ['expense', 'income']) {
      for (const c of state.categories[kind]) {
        chips.push(`<span class="chip"><span class="dot" style="background:${esc(c.color)}"></span>${esc(
          c.name
        )}<span class="kind">${kind === 'expense' ? 'despesa' : 'receita'}</span></span>`);
      }
    }
    $('#categoryList').innerHTML = chips.join('');
  }

  /* ---------------- View / navigation ---------------- */

  function switchView(name) {
    $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + name));
    $$('.bottomnav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- Sheet ---------------- */

  function openSheet(name) {
    const sheet = $('#' + name + 'Sheet');
    const backdrop = $('#' + name + 'Backdrop');
    if (!sheet || !backdrop) return;
    backdrop.hidden = false;
    sheet.hidden = false;
    document.body.classList.add('locked');
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      sheet.classList.add('open');
    });
  }

  function closeSheet(name) {
    const sheet = $('#' + name + 'Sheet');
    const backdrop = $('#' + name + 'Backdrop');
    if (!sheet || !backdrop) return;
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.classList.remove('locked');
    window.setTimeout(() => {
      sheet.hidden = true;
      backdrop.hidden = true;
    }, 240);
  }

  /* ---------------- Add / edit transaction ---------------- */

  function syncTypeToggle() {
    $$('#typeToggle button').forEach((b) => {
      const active = b.dataset.type === formType;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  }

  function populateCategorySelect(selected) {
    const cats = state.categories[formType] || [];
    const select = $('#fCategory');
    select.innerHTML = cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    if (selected && cats.some((c) => c.name === selected)) select.value = selected;
  }

  function openAdd(tx, defaultDate) {
    editingId = tx ? tx.id : null;
    formType = tx ? tx.type : 'expense';
    $('#addTitle').textContent = tx ? 'Editar lançamento' : 'Novo lançamento';
    $('#fAmount').value = tx ? formatAmountInput(tx.amount) : '';
    $('#fDate').value = tx ? tx.date : defaultDate || todayISO();
    $('#fNote').value = tx ? tx.note || '' : '';
    $('#fId').value = tx ? tx.id : '';
    $('#repeatRow').classList.toggle('hidden', !!tx);
    $('#fRepeat').value = 'none';
    $('#fRepeatCount').value = '3';
    $('#repeatCountField').classList.add('hidden');
    syncTypeToggle();
    populateCategorySelect(tx ? tx.category : null);
    $('#deleteTx').classList.toggle('hidden', !tx);
    openSheet('add');
    window.setTimeout(() => {
      const input = $('#fAmount');
      if (input) input.focus();
    }, 300);
  }

  function populateSelect(selector, cats, selected) {
    const select = $(selector);
    select.innerHTML = cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    if (selected && cats.some((c) => c.name === selected)) select.value = selected;
  }

  function fillCountSelect(selector, min, max, selected) {
    const select = $('#' + selector);
    if (!select.options.length) {
      for (let i = min; i <= max; i++) {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = String(i);
        select.appendChild(option);
      }
    }
    select.value = String(selected || min);
  }

  function openInstallment() {
    $('#iLabel').value = '';
    $('#iTotal').value = '';
    $('#iCard').value = '';
    $('#iDate').value = todayISO();
    fillCountSelect('iCount', 2, 12, 12);
    populateSelect('#iCategory', state.categories.expense);
    $('#instPreview').textContent = '';
    openSheet('inst');
    window.setTimeout(() => $('#iTotal').focus(), 300);
  }

  function openInvoice() {
    ensureCategory('Cartão de crédito', 'expense', '#0f766e');
    $('#vCard').value = '';
    $('#vAmount').value = '';
    $('#vDate').value = nextMonthFirstISO();
    populateSelect('#vCategory', state.categories.expense, 'Cartão de crédito');
    openSheet('inv');
    window.setTimeout(() => $('#vCard').focus(), 300);
  }

  function updateInstallmentPreview() {
    const total = parseAmount($('#iTotal').value);
    const count = Number($('#iCount').value) || 0;
    if (!isFinite(total) || total <= 0 || count < 2) {
      $('#instPreview').textContent = '';
      return;
    }
    const monthly = round2(total / count);
    const last = round2(total - monthly * (count - 1));
    $('#instPreview').textContent =
      last !== monthly
        ? `${count}x de ${brl(monthly)} + última de ${brl(last)} · total ${brl(total)}`
        : `${count}x de ${brl(monthly)} · total ${brl(total)}`;
  }

  function createInstallments(event) {
    event.preventDefault();
    const label = $('#iLabel').value.trim();
    const total = parseAmount($('#iTotal').value);
    const count = Number($('#iCount').value) || 0;
    const date = $('#iDate').value;
    const category = $('#iCategory').value;
    const card = $('#iCard').value.trim();
    if (!label) {
      toast('Informe uma descrição');
      $('#iLabel').focus();
      return;
    }
    if (!isFinite(total) || total <= 0) {
      toast('Informe o valor total');
      $('#iTotal').focus();
      return;
    }
    if (count < 2 || count > 12) {
      toast('Escolha de 2 a 12 parcelas');
      return;
    }
    if (!date) {
      toast('Informe a data da primeira parcela');
      return;
    }
    if (!category) {
      toast('Escolha uma categoria');
      return;
    }

    const groupId = uid();
    const base = parseISO(date);
    const baseAmount = round2(total / count);
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const when = i === 0 ? base : addPeriod(base, 'monthly', i);
      const amount = i === count - 1 ? round2(total - baseAmount * (count - 1)) : baseAmount;
      state.transactions.push({
        id: uid(),
        createdAt: now + i,
        type: 'expense',
        amount,
        category,
        date: isoFromDate(when),
        note: `${label} (${i + 1}/${count})`,
        groupId,
        groupType: 'installment',
        part: i + 1,
        parts: count,
      });
    }
    state.groups.push({
      id: groupId,
      type: 'installment',
      label,
      card,
      category,
      startDate: date,
      createdAt: now,
    });
    save();
    const d = parseISO(date);
    viewDate = new Date(d.getFullYear(), d.getMonth(), 1);
    closeSheet('inst');
    render();
    toast(`${count} parcelas criadas`);
  }

  function createInvoices(event) {
    event.preventDefault();
    const card = $('#vCard').value.trim();
    const amount = parseAmount($('#vAmount').value);
    const date = $('#vDate').value;
    const category = $('#vCategory').value;
    if (!card) {
      toast('Informe o nome do cartão');
      $('#vCard').focus();
      return;
    }
    if (!isFinite(amount) || amount <= 0) {
      toast('Informe o valor da fatura');
      $('#vAmount').focus();
      return;
    }
    if (!date) {
      toast('Informe o vencimento');
      return;
    }
    if (!category) {
      toast('Escolha uma categoria');
      return;
    }

    ensureCategory(category, 'expense', '#0f766e');
    state.transactions.push({
      id: uid(),
      createdAt: Date.now(),
      type: 'expense',
      amount: round2(amount),
      category,
      date,
      note: `Fatura ${card}`,
      invoice: true,
      card,
    });
    save();
    const d = parseISO(date);
    viewDate = new Date(d.getFullYear(), d.getMonth(), 1);
    closeSheet('inv');
    render();
    toast('Fatura registrada');
  }

  function handleSubmit(event) {
    event.preventDefault();
    const amount = parseAmount($('#fAmount').value);
    if (!isFinite(amount) || amount <= 0) {
      toast('Informe um valor maior que zero');
      $('#fAmount').focus();
      return;
    }
    const category = $('#fCategory').value;
    const date = $('#fDate').value;
    if (!category) {
      toast('Escolha uma categoria');
      return;
    }
    if (!date) {
      toast('Informe a data');
      return;
    }
    const note = $('#fNote').value.trim().slice(0, 80);
    const payload = { type: formType, amount: round2(amount), category, date, note };

    const repeat = editingId ? 'none' : $('#fRepeat').value;
    let occurrences = 1;
    if (repeat !== 'none') {
      if (date < todayISO()) {
        toast('Para repetir, escolha uma data de hoje em diante');
        return;
      }
      occurrences = Math.round(Number($('#fRepeatCount').value) || 0);
      if (!isFinite(occurrences) || occurrences < 2) occurrences = 2;
      if (occurrences > 60) occurrences = 60;
    }

    if (editingId) {
      const existing = state.transactions.find((t) => t.id === editingId);
      if (existing) Object.assign(existing, payload);
      toast('Lançamento atualizado');
    } else if (occurrences > 1) {
      const base = parseISO(date);
      const now = Date.now();
      for (let i = 0; i < occurrences; i++) {
        const when = i === 0 ? base : addPeriod(base, repeat, i);
        state.transactions.push({
          id: uid(),
          createdAt: now + i,
          ...payload,
          date: isoFromDate(when),
        });
      }
      toast(`Previsão criada: ${occurrences} lançamentos`);
    } else {
      state.transactions.push({ id: uid(), createdAt: Date.now(), ...payload });
      toast('Lançamento salvo');
    }
    save();

    const d = parseISO(date);
    viewDate = new Date(d.getFullYear(), d.getMonth(), 1);
    editingId = null;
    closeSheet('add');
    render();
  }

  /* ---------------- Budgets ---------------- */

  function handleBudgetChange(input) {
    const name = input.dataset.budget;
    if (!name) return;
    const value = parseAmount(input.value);
    if (!isFinite(value) || value <= 0) delete state.budgets[name];
    else state.budgets[name] = round2(value);
    save();
    updateOrcamentoRow(name, input);
    renderResumo();
    updateOrcamentoSummary();
  }

  function updateOrcamentoRow(name, input) {
    const row = $$('.orcrow').find((r) => r.dataset.cat === name);
    if (!row) return;
    const tx = monthTransactions();
    const spent = tx
      .filter((t) => t.type === 'expense' && t.category === name)
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const cat = findCat(name, 'expense');
    const budget = Number(state.budgets[name]) || 0;
    const pct = budget ? Math.min(Math.round((spent / budget) * 100), 100) : 0;
    const over = budget > 0 && spent > budget;
    const amountEl = row.querySelector('.orc-amount');
    if (amountEl) amountEl.textContent = budget ? `${brl(spent)} / ${brl(budget)}` : brl(spent);
    const bar = row.querySelector('.bar > span');
    if (bar) {
      bar.style.width = pct + '%';
      bar.classList.toggle('over', over);
      bar.style.background = over ? '' : cat.color;
    }
    if (budget > 0 && !input.value.trim()) input.value = formatAmountInput(budget);
    if (budget <= 0) input.value = '';
  }

  function updateOrcamentoSummary() {
    const expense = sumBy(monthTransactions(), 'expense');
    const budget = totalBudget();
    const pct = budget ? Math.round((expense / budget) * 100) : 0;
    $('#orcPct').textContent = budget ? pct + '%' : '';
    const bar = $('#orcBar');
    bar.style.width = budget ? Math.min(pct, 100) + '%' : '0%';
    bar.classList.toggle('over', !!budget && expense > budget);
    $('#orcText').textContent = budget
      ? expense <= budget
        ? `Orçamento de ${brl(budget)} · restam ${brl(budget - expense)}`
        : `Orçamento de ${brl(budget)} · excedeu ${brl(expense - budget)}`
      : 'Defina um orçamento por categoria abaixo.';
  }

  /* ---------------- Settings: categories, export, import ---------------- */

  function addCategory() {
    const name = $('#newCatName').value.trim();
    const kind = $('#newCatKind').value === 'income' ? 'income' : 'expense';
    if (!name) {
      toast('Digite o nome da categoria');
      return;
    }
    if (state.categories[kind].some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast('Essa categoria já existe');
      return;
    }
    const color = PALETTE[state.categories[kind].length % PALETTE.length];
    state.categories[kind].push({ name, color });
    save();
    $('#newCatName').value = '';
    renderSettingsCategories();
    render();
    toast('Categoria adicionada');
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportJSON() {
    const stamp = todayISO();
    download(`financas-backup-${stamp}.json`, JSON.stringify(state, null, 2), 'application/json');
    toast('Backup exportado');
  }

  function exportCSV() {
    const header = ['Data', 'Tipo', 'Categoria', 'Valor', 'Descrição'];
    const escCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.map(escCsv).join(';')].concat(
      sortTx(state.transactions).map((t) =>
        [
          t.date,
          t.type === 'expense' ? 'Despesa' : 'Receita',
          t.category,
          (Number(t.amount) || 0).toFixed(2).replace('.', ','),
          t.note || '',
        ]
          .map(escCsv)
          .join(';')
      )
    );
    download(`financas-${todayISO()}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    toast('CSV exportado');
  }

  async function importJSON(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.transactions)) throw new Error('Formato inválido');
      if (!confirm('Substituir todos os dados atuais pelo backup?')) return;
      state = normalizeState(data);
      save();
      render();
      renderSettingsCategories();
      closeSheet('set');
      toast('Backup importado');
    } catch (err) {
      console.error(err);
      toast('Arquivo inválido');
    }
  }

  function resetAll() {
    if (!confirm('Apagar TODOS os lançamentos, orçamentos e categorias? Isso não pode ser desfeito.')) return;
    state = defaultState();
    save();
    render();
    renderSettingsCategories();
    closeSheet('set');
    toast('Dados apagados');
  }

  /* ---------------- Toast ---------------- */

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 2300);
  }

  /* ---------------- Events ---------------- */

  function bindEvents() {
    $('#prevMonth').addEventListener('click', () => {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
      render();
    });
    $('#nextMonth').addEventListener('click', () => {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
      render();
    });
    $('#monthLabel').addEventListener('click', () => {
      viewDate = currentMonth();
      render();
    });

    $$('.bottomnav [data-view]').forEach((btn) =>
      btn.addEventListener('click', () => switchView(btn.dataset.view))
    );

    $('#lancFilter').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-filter]');
      if (!btn) return;
      filterType = btn.dataset.filter;
      $$('#lancFilter button').forEach((b) => b.classList.toggle('active', b === btn));
      renderLancamentos();
    });

    $('#fab').addEventListener('click', () => openAdd(null));
    $('#closeAdd').addEventListener('click', () => closeSheet('add'));
    $('#cancelAdd').addEventListener('click', () => closeSheet('add'));
    $('#addBackdrop').addEventListener('click', () => closeSheet('add'));

    $('#openSettings').addEventListener('click', () => {
      renderSettingsCategories();
      openSheet('set');
    });
    $('#closeSet').addEventListener('click', () => closeSheet('set'));
    $('#setBackdrop').addEventListener('click', () => closeSheet('set'));

    $('#typeToggle').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-type]');
      if (!btn) return;
      formType = btn.dataset.type;
      syncTypeToggle();
      populateCategorySelect();
    });

    $('#txForm').addEventListener('submit', handleSubmit);

    $('#fRepeat').addEventListener('change', () => {
      const active = $('#fRepeat').value !== 'none';
      $('#repeatCountField').classList.toggle('hidden', !active);
    });

    $('#addForecast').addEventListener('click', () => openAdd(null, nextMonthFirstISO()));

    $('#deleteTx').addEventListener('click', () => {
      if (!editingId) return;
      const tx = state.transactions.find((t) => t.id === editingId);
      if (!tx) return;
      if (!confirm('Excluir este lançamento?')) return;
      state.transactions = state.transactions.filter((t) => t.id !== editingId);
      save();
      editingId = null;
      closeSheet('add');
      render();
      toast('Lançamento excluído');
    });

    $('#newInstallment').addEventListener('click', openInstallment);
    $('#newInvoice').addEventListener('click', openInvoice);
    $('#closeInst').addEventListener('click', () => closeSheet('inst'));
    $('#cancelInst').addEventListener('click', () => closeSheet('inst'));
    $('#instBackdrop').addEventListener('click', () => closeSheet('inst'));
    $('#instForm').addEventListener('submit', createInstallments);
    $('#iTotal').addEventListener('input', updateInstallmentPreview);
    $('#iCount').addEventListener('change', updateInstallmentPreview);

    $('#closeInv').addEventListener('click', () => closeSheet('inv'));
    $('#cancelInv').addEventListener('click', () => closeSheet('inv'));
    $('#invBackdrop').addEventListener('click', () => closeSheet('inv'));
    $('#invForm').addEventListener('submit', createInvoices);

    $('#addCatBtn').addEventListener('click', addCategory);
    $('#newCatName').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addCategory();
      }
    });

    $('#exportJson').addEventListener('click', exportJSON);
    $('#exportCsv').addEventListener('click', exportCSV);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) importJSON(file);
      event.target.value = '';
    });
    $('#resetBtn').addEventListener('click', resetAll);

    document.addEventListener('change', (event) => {
      const input = event.target.closest('[data-budget]');
      if (input) handleBudgetChange(input);
    });

    document.addEventListener('click', (event) => {
      const delGroup = event.target.closest('[data-delgroup]');
      if (delGroup) {
        event.stopPropagation();
        const group = state.groups.find((g) => g.id === delGroup.dataset.delgroup);
        if (
          group &&
          confirm(`Excluir as parcelas/faturas futuras de "${group.label}"? As já pagas serão mantidas.`)
        ) {
          const today = todayISO();
          state.transactions = state.transactions.filter(
            (t) => !(t.groupId === group.id && t.date > today)
          );
          state.groups = state.groups.filter((g) => g.id !== group.id);
          save();
          render();
          toast('Gastos futuros do grupo excluídos');
        }
        return;
      }

      const delInvoice = event.target.closest('[data-delinvoice]');
      if (delInvoice) {
        event.stopPropagation();
        const id = delInvoice.dataset.delinvoice;
        const tx = state.transactions.find((t) => t.id === id);
        if (tx && confirm(`Excluir a fatura de ${tx.card || tx.note}?`)) {
          state.transactions = state.transactions.filter((t) => t.id !== id);
          save();
          render();
          toast('Fatura excluída');
        }
        return;
      }

      const invoiceRow = event.target.closest('[data-invoice]');
      if (invoiceRow) {
        const tx = state.transactions.find((t) => t.id === invoiceRow.dataset.invoice);
        if (tx) openAdd(tx);
        return;
      }

      const del = event.target.closest('[data-del]');
      if (del) {
        event.stopPropagation();
        const tx = state.transactions.find((t) => t.id === del.dataset.del);
        if (tx && confirm(`Excluir "${tx.note || tx.category}"?`)) {
          state.transactions = state.transactions.filter((t) => t.id !== tx.id);
          save();
          render();
          toast('Lançamento excluído');
        }
        return;
      }
      const row = event.target.closest('.tx');
      if (row) {
        const tx = state.transactions.find((t) => t.id === row.dataset.id);
        if (tx) openAdd(tx);
        return;
      }
      const goto = event.target.closest('[data-goto]');
      if (goto) switchView(goto.dataset.goto);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!$('#addSheet').hidden) closeSheet('add');
        if (!$('#setSheet').hidden) closeSheet('set');
        if (!$('#instSheet').hidden) closeSheet('inst');
        if (!$('#invSheet').hidden) closeSheet('inv');
      }
      const target = event.target;
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        (target.classList.contains('tx') || target.hasAttribute('data-invoice'))
      ) {
        event.preventDefault();
        const id = target.dataset.id || target.dataset.invoice;
        const tx = state.transactions.find((t) => t.id === id);
        if (tx) openAdd(tx);
      }
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const secure =
      location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW não registrado', err));
    });
  }

  bindEvents();
  render();
  renderSettingsCategories();
  registerServiceWorker();
})();
