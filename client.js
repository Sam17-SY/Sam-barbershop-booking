// 网页版共用：调用后台、提示框、iOS 风格的弹窗 / 底部菜单 / 滚轮
var $ = function (id) { return document.getElementById(id) }
// 网址后面加 ?demo=1 也会进入演示模式（不碰正式数据，方便试新功能）
var SAM_DEMO = !window.SAM_API_URL || /[?&]demo=1\b/.test(location.search)
var samDemoBackend = SAM_DEMO ? createSamBackend(SAM_DEFAULT_CONFIG, createDemoStore(SAM_DEFAULT_CONFIG)) : null

// 调用后台：正式模式发到 Google Apps Script；演示模式直接在浏览器里跑同一份规则
function api(action, data) {
  if (SAM_DEMO) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(JSON.parse(JSON.stringify(samDemoBackend.handle(action, data)))) } catch (e) { reject(e) }
      }, 250)
    })
  }
  // 用 text/plain 发送，避免浏览器先发跨域预检请求（Apps Script 不支持）
  return fetch(window.SAM_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, data: data || {} })
  }).then(function (r) { return r.json() }).then(function (res) {
    if (res && res.error) throw new Error(res.error)
    return res
  }, function (err) {
    if (err instanceof Error && !/fetch|network/i.test(err.message)) throw err
    throw new Error('网络不太好，请稍后再试')
  })
}

// 本机记住的东西（顾客的名字、手机号、付款方式；店主密码）。读写失败也不影响使用
var memory = {
  get: function (k) { try { return localStorage.getItem('sam-' + k) || '' } catch (e) { return '' } },
  set: function (k, v) { try { localStorage.setItem('sam-' + k, v) } catch (e) {} },
  del: function (k) { try { localStorage.removeItem('sam-' + k) } catch (e) {} }
}

function pad2(n) { return String(n).padStart(2, '0') }
function addMinutes(hhmm, add) {
  var p = hhmm.split(':').map(Number), t = p[0] * 60 + p[1] + add
  return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60)
}
function dateLabel(date) { var p = date.split('-').map(Number); return p[1] + '月' + p[2] + '日' }
function money(n) { return '$' + (n % 1 ? n.toFixed(2) : n) }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
function prettyPhone(d) {
  d = String(d || '')
  if (d.length === 11 && d[0] === '1') return '+1 ' + d.slice(1, 4) + '-' + d.slice(4, 7) + '-' + d.slice(7)
  return '+' + d
}

// 按下时缩小，模拟小程序的 hover-class
function press(el, cls) {
  el.addEventListener('pointerdown', function () { el.classList.add(cls) })
  ;['pointerup', 'pointerleave', 'pointercancel'].forEach(function (e) { el.addEventListener(e, function () { el.classList.remove(cls) }) })
}

var toastEl
function showToast(text) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl) }
  toastEl.textContent = text
  toastEl.classList.add('toast-show')
  clearTimeout(showToast.t)
  showToast.t = setTimeout(function () { toastEl.classList.remove('toast-show') }, 1800)
}

function copyText(text, msg) {
  var done = function () { showToast(msg || '已复制') }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, fallback)
  } else fallback()
  function fallback() {
    var ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); done() } catch (e) { showModal({ title: '复制失败', content: '请手动记下：' + text, confirmText: '好', single: true }) }
    ta.remove()
  }
}

// iOS 风格弹窗；传 input 时带一个输入框
function showModal(o) {
  var root = document.createElement('div')
  root.className = 'alert-root'
  root.innerHTML = '<div class="alert"><div class="alert-body"><div class="alert-title"></div><div class="alert-content"></div></div>' +
    '<div class="alert-actions"><div class="alert-btn alert-cancel"></div><div class="alert-btn alert-ok"></div></div></div>'
  root.querySelector('.alert-title').textContent = o.title
  var body = root.querySelector('.alert-content')
  var input
  if (o.input) {
    input = document.createElement('input')
    input.className = 'alert-input'
    input.placeholder = o.input
    if (o.inputType) input.type = o.inputType
    if (o.inputMode) input.inputMode = o.inputMode
    if (o.content) { var p = document.createElement('div'); p.textContent = o.content; body.appendChild(p) }
    body.appendChild(input)
  } else body.textContent = o.content || ''
  var cancel = root.querySelector('.alert-cancel'), ok = root.querySelector('.alert-ok')
  cancel.textContent = o.cancelText || '取消'
  ok.textContent = o.confirmText || '确定'
  if (o.danger) ok.classList.add('alert-danger')
  if (o.single) cancel.remove()
  document.body.appendChild(root)
  requestAnimationFrame(function () { root.classList.add('alert-open') })
  if (input) setTimeout(function () { input.focus() }, 300)
  var close = function () { root.classList.remove('alert-open'); setTimeout(function () { root.remove() }, 250) }
  cancel.onclick = close
  ok.onclick = function () { close(); if (o.onConfirm) o.onConfirm(input ? input.value : undefined) }
}

// iOS 风格底部菜单
function showActionSheet(o) {
  var root = document.createElement('div')
  root.className = 'as-root'
  root.innerHTML = '<div class="as-mask"></div><div class="as-sheet"><div class="as-group"><div class="as-title"></div></div><div class="as-group"><div class="as-btn as-cancel">取消</div></div></div>'
  root.querySelector('.as-title').textContent = o.title
  var group = root.querySelector('.as-group')
  var close = function () { root.classList.remove('as-open'); setTimeout(function () { root.remove() }, 400) }
  o.items.forEach(function (t, i) {
    var btn = document.createElement('div')
    btn.className = 'as-btn' + (o.dangerIndex === i ? ' as-danger' : '') + (o.mutedIndexes && o.mutedIndexes.indexOf(i) >= 0 ? ' as-muted' : '')
    btn.textContent = t
    btn.onclick = function () { close(); o.onPick(i) }
    group.appendChild(btn)
  })
  document.body.appendChild(root)
  requestAnimationFrame(function () { root.classList.add('as-open') })
  root.querySelector('.as-mask').onclick = close
  root.querySelector('.as-cancel').onclick = close
}

// 多选清单（底部弹出，可勾选多项，点“确定”保存）
function showChecklist(o) {
  var picked = o.selected.slice()
  var root = document.createElement('div')
  root.className = 'wheel-root'
  root.innerHTML = '<div class="wheel-mask"></div><div class="wheel-sheet"><div class="wheel-bar"><span class="wheel-cancel">取消</span><span class="wheel-title"></span><span class="wheel-ok">确定</span></div><div class="check-list"></div></div>'
  root.querySelector('.wheel-title').textContent = o.title
  var list = root.querySelector('.check-list')
  o.items.forEach(function (t, i) {
    var row = document.createElement('div')
    row.className = 'check-row' + (picked.indexOf(i) >= 0 ? ' check-on' : '')
    row.innerHTML = '<span></span><span class="check-mark">✓</span>'
    row.firstChild.textContent = t
    row.onclick = function () {
      var k = picked.indexOf(i)
      if (k >= 0) picked.splice(k, 1); else picked.push(i)
      row.classList.toggle('check-on', k < 0)
    }
    list.appendChild(row)
  })
  document.body.appendChild(root)
  requestAnimationFrame(function () { root.classList.add('wheel-open') })
  var close = function () { root.classList.remove('wheel-open'); setTimeout(function () { root.remove() }, 450) }
  root.querySelector('.wheel-mask').onclick = close
  root.querySelector('.wheel-cancel').onclick = close
  root.querySelector('.wheel-ok').onclick = function () { close(); o.onConfirm(picked.sort()) }
}

// 滚轮选择器（模拟 iPhone 的滚轮）。按“确定”时读取滚轮当前停的位置
function openWheel(o) {
  var ITEM_H = 40
  var root = document.createElement('div')
  root.className = 'wheel-root'
  root.innerHTML = '<div class="wheel-mask"></div><div class="wheel-sheet"><div class="wheel-bar"><span class="wheel-cancel">取消</span><span class="wheel-title"></span><span class="wheel-ok">确定</span></div><div class="wheel-cols"><div class="wheel-band"></div></div></div>'
  root.querySelector('.wheel-title').textContent = o.title
  var colsEl = root.querySelector('.wheel-cols')
  var cols = o.columns.map(function (c, ci) {
    if (ci > 0 && o.separator) { var sep = document.createElement('div'); sep.className = 'wheel-sep'; sep.textContent = o.separator; colsEl.appendChild(sep) }
    var col = document.createElement('div')
    col.className = 'wheel-col'
    col.innerHTML = '<div class="wheel-pad"></div>' + c.items.map(function (t) { return '<div class="wheel-item">' + t + '</div>' }).join('') + '<div class="wheel-pad"></div>'
    colsEl.appendChild(col)
    var items = col.querySelectorAll('.wheel-item')
    var read = function () { return Math.min(items.length - 1, Math.max(0, Math.round(col.scrollTop / ITEM_H))) }
    var mark = function () { var i = read(); items.forEach(function (el, j) { el.classList.toggle('on', j === i) }) }
    col.addEventListener('scroll', mark)
    items.forEach(function (el, i) { el.onclick = function () { col.scrollTo({ top: i * ITEM_H, behavior: 'smooth' }) } })
    return { col: col, mark: mark, read: read, index: Math.max(c.index, 0) }
  })
  document.body.appendChild(root)
  cols.forEach(function (c) { c.col.scrollTop = c.index * ITEM_H; c.mark() })
  requestAnimationFrame(function () { root.classList.add('wheel-open') })
  var close = function () { root.classList.remove('wheel-open'); setTimeout(function () { root.remove() }, 450) }
  root.querySelector('.wheel-mask').onclick = close
  root.querySelector('.wheel-cancel').onclick = close
  root.querySelector('.wheel-ok').onclick = function () { close(); o.onConfirm(cols.map(function (c) { return c.read() })) }
}

// 演示模式的提示条
function showDemoBanner(extra) {
  if (!SAM_DEMO) return
  var bar = document.createElement('div')
  bar.className = 'demo-banner'
  bar.textContent = '演示模式 · 数据只保存在这台设备上' + (extra || '')
  document.body.appendChild(bar)
}
