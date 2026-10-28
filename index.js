// 顾客预约页（中英文切换见 i18n.js）
var PAYS = [{ key: 'cash' }, { key: 'zelle' }]
var st = { data: null, di: 0, sel: '', pay: 0, submitting: false }

function payLabel(key) { return key === 'zelle' ? 'Zelle' : t('cash') }
function period(time) { var h = Number(time.slice(0, 2)); return h < 12 ? t('morning') : h < 18 ? t('afternoon') : t('evening') }
// 副标题里的时间：中文“下午 2:00”，英文“2:00 PM”
function friendlyTime(time) {
  if (LANG === 'en') return fmtTime(time)
  var p = time.split(':').map(Number)
  return period(time) + ' ' + (p[0] > 12 ? p[0] - 12 : p[0]) + ':' + pad2(p[1])
}
function dayText(day) { return LANG === 'en' ? fmtWeekday(day.weekday) + ', ' + fmtDate(day.date) : fmtDate(day.date) + ' ' + day.weekday }
function rangeText(time, minutes) { return fmtTime(time) + ' – ' + fmtTime(addMinutes(time, minutes)) }

function load() {
  return api('getSlots', { phone: memory.get('phone') }).then(function (res) {
    st.data = res
    st.sel = ''
    var di = res.dates.findIndex(function (d) { return !d.bookedByMe })
    st.di = di < 0 ? 0 : di
    renderAll()
    $('loading').style.display = 'none'
    $('content').style.display = ''
  }).catch(function (err) { showToast(err.message) })
}

function renderAll() {
  var d = st.data, shop = d.shop
  var WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  // 旧版后台没有 openWeekdays，就用第一个营业日的星期
  var nums = d.openWeekdays || d.dates.slice(0, 1).map(function (x) { return WD.indexOf(x.weekday) })
  var days = nums.map(function (n) { return LANG === 'en' ? WEEKDAY_EN_LONG[n] : WD[n] })
  $('subtitle').textContent = t('every', { days: days.join(LANG === 'en' ? ' & ' : '、') }) + ' · ' + friendlyTime(d.startTime) + ' – ' + friendlyTime(d.endTime)
  $('addr').textContent = shop.address
  $('door').textContent = shop.doorNumber
  $('wechat').textContent = shop.wechat
  $('shopPhone').textContent = shop.phone
  $('phoneRow').href = 'tel:' + shop.phone.replace(/[^\d+]/g, '')
  $('zelleAcct').textContent = shop.zelle
  $('footerBrand').textContent = shop.name + ' · ' + shop.city
  renderTickets(); renderDates(); renderSlots(); updateCta()
}

function renderTickets() {
  var d = st.data, shop = d.shop
  $('tickets').innerHTML = d.myBookings.map(function (b) {
    var end = addMinutes(b.time, b.minutes || d.slotMinutes)
    // 大字号的开始时间；英文把 AM/PM 放进后面的小字
    var big = LANG === 'en' ? fmtTime(b.time).split(' ')[0] : b.time
    var small = LANG === 'en' ? ' ' + fmtTime(b.time).split(' ')[1] + ' – ' + fmtTime(end) : ' – ' + end
    return '<div class="ticket fade-up">' +
      '<div class="ticket-top"><div class="ticket-brand"><img class="ticket-logo" src="images/logo-icon.png" alt="">' + esc(shop.name) + '</div><div class="badge">' + t('booked') + '</div></div>' +
      '<div class="ticket-date">' + fmtDate(b.date) + ' · ' + fmtWeekday(b.weekday) + '</div>' +
      '<div class="ticket-time">' + big + '<span class="ticket-end">' + small + '</span></div>' +
      '<div class="ticket-name">' + esc(b.name) + ' · ' + t('paidBy', { pay: payLabel(b.payment) }) + '</div>' +
      '<div class="ticket-divider"></div>' +
      '<div class="ticket-addr">' + esc(shop.address) + '</div><div class="ticket-door">' + esc(shop.doorNumber) + '</div>' +
      '<div class="ticket-actions"><div class="ticket-btn" data-copy="1">' + t('copyAddr') + '</div><div class="ticket-btn ticket-btn-danger" data-id="' + b.id + '">' + t('cancelBooking') + '</div></div>' +
      '</div>'
  }).join('')
  $('tickets').querySelectorAll('.ticket-btn').forEach(function (el) { press(el, 'ticket-btn-pressed') })
  $('tickets').querySelectorAll('[data-copy]').forEach(function (el) { el.onclick = copyAddress })
  $('tickets').querySelectorAll('.ticket-btn-danger').forEach(function (el) {
    el.onclick = function () {
      showModal({
        title: t('cancelQ'), content: t('cancelBody'), confirmText: t('cancelBooking'), cancelText: t('keep'), danger: true,
        onConfirm: function () {
          api('cancel', { id: el.dataset.id, phone: memory.get('phone') }).then(function () { showToast(t('cancelled')); return load() })
            .catch(function (err) { showToast(err.message) })
        }
      })
    }
  })
  var mine = d.myBookings.length > 0
  $('addrRow').style.display = mine ? 'none' : ''
  $('contactHeader').textContent = mine ? t('contactOwner') : t('contactTitle')
}

function renderDates() {
  var dates = st.data.dates
  // 4 天以内用分段控件（滑块会滑动）；更多天时改成可以横向滑动的小卡片
  var chips = dates.length > 4
  $('dateSeg').className = chips ? 'date-chips' : 'segmented'
  var items = dates.map(function (d, i) {
    var full = d.slots.every(function (s) { return !s.available })
    return '<div class="' + (chips ? 'date-chip' : 'seg-item') + (i === st.di ? ' seg-on' : '') + '" data-i="' + i + '"><div class="seg-label">' + fmtDate(d.date) + '</div><div class="seg-sub">' + (d.bookedByMe ? t('booked') : full ? t('fullShort') : fmtWeekday(d.weekday)) + '</div></div>'
  }).join('')
  $('dateSeg').innerHTML = !dates.length ? ''
    : chips ? items
    : '<div class="seg-indicator" id="ind" style="width: calc((100% - 4px) / ' + dates.length + '); transform: translateX(' + st.di * 100 + '%)"></div>' + items
  $('dateSeg').querySelectorAll('[data-i]').forEach(function (el) {
    press(el, 'seg-pressed')
    el.onclick = function () {
      var i = Number(el.dataset.i)
      if (i === st.di) return
      st.di = i; st.sel = ''
      if ($('ind')) $('ind').style.transform = 'translateX(' + i * 100 + '%)'
      $('dateSeg').querySelectorAll('[data-i]').forEach(function (s, j) { s.classList.toggle('seg-on', j === i) })
      renderSlots(); updateCta()
    }
  })
}

function emptyBox(title, sub) {
  return '<div class="empty fade-up"><div class="empty-title">' + title + '</div><div class="empty-sub">' + sub + '</div></div>'
}

function renderSlots() {
  var day = st.data.dates[st.di], area = $('slotArea')
  if (!day) {
    $('slotNote').textContent = ''
    area.innerHTML = emptyBox(t('closedTitle'), t('closedSub'))
    return
  }
  var left = day.slots.filter(function (s) { return s.available }).length
  if (day.bookedByMe) {
    $('slotNote').textContent = ''
    area.innerHTML = emptyBox(t('bookedWeek'), t('onePerWeek'))
    return
  }
  if (!left) {
    $('slotNote').textContent = ''
    area.innerHTML = emptyBox(t('full'), t('nextWeek'))
    return
  }
  $('slotNote').textContent = t('slotNote', { n: left, m: st.data.slotMinutes })
  // 按下午 / 晚上分组
  var groups = []
  day.slots.forEach(function (s, i) {
    var g = groups[groups.length - 1]
    if (!g || g.label !== period(s.time)) groups.push(g = { label: period(s.time), slots: [] })
    g.slots.push({ s: s, i: i })
  })
  area.innerHTML = groups.map(function (g) {
    return '<div class="period slot-in" style="animation-delay:' + (g.slots[0].i * 25) + 'ms">' + g.label + '</div><div class="slots">' +
      g.slots.map(function (x) {
        return '<div class="slot slot-in' + (x.s.available ? '' : ' slot-taken') + (x.s.time === st.sel ? ' slot-on' : '') + '" data-t="' + x.s.time + '" style="animation-delay:' + (x.i * 25) + 'ms">' + fmtTime(x.s.time) + '</div>'
      }).join('') + '</div>'
  }).join('')
  area.querySelectorAll('.slot:not(.slot-taken)').forEach(function (el) {
    press(el, 'slot-pressed')
    el.onclick = function () {
      st.sel = st.sel === el.dataset.t ? '' : el.dataset.t
      area.querySelectorAll('.slot').forEach(function (s) { s.classList.toggle('slot-on', s.dataset.t === st.sel) })
      updateCta()
    }
  })
}

function updateCta() {
  var day = st.data && st.data.dates[st.di]
  $('cta').classList.toggle('cta-show', !!st.sel && $('sheet').style.display === 'none')
  if (st.sel && day) {
    $('ctaLabel').textContent = dayText(day)
    $('ctaValue').textContent = rangeText(st.sel, st.data.slotMinutes)
  }
}

function openSheet() {
  var name = $('name').value.trim(), phone = $('phone').value.replace(/\D/g, '')
  if (!name) { showToast(t('needName')); $('name').focus(); return }
  if (phone.length < 10) { showToast(t('needPhone')); $('phone').focus(); return }
  var day = st.data.dates[st.di], shop = st.data.shop
  $('sName').textContent = name
  $('sPhone').textContent = $('phone').value.trim()
  $('sTime').textContent = dayText(day) + ' ' + rangeText(st.sel, st.data.slotMinutes)
  $('sPay').textContent = payLabel(PAYS[st.pay].key)
  $('sAddr').innerHTML = esc(shop.address) + '<br>' + esc(shop.doorNumber)
  $('confirm').style.display = ''; $('done').style.display = 'none'
  $('sheet').style.display = ''
  updateCta()
  setTimeout(function () { $('sheet').classList.add('sheet-open') }, 30)
}

function closeSheet() {
  if (st.submitting) return
  $('sheet').classList.remove('sheet-open')
  setTimeout(function () { $('sheet').style.display = 'none'; updateCta() }, 500)
}

function submit() {
  if (st.submitting) return
  st.submitting = true
  var day = st.data.dates[st.di], name = $('name').value.trim(), phone = $('phone').value.trim()
  $('submit').innerHTML = '<div class="spinner"></div>'
  api('book', { name: name, phone: phone, payment: PAYS[st.pay].key, date: day.date, time: st.sel }).then(function (res) {
    memory.set('name', name); memory.set('phone', phone); memory.set('payment', PAYS[st.pay].key)
    var b = res.booking, shop = st.data.shop
    $('dHello').textContent = t('hello', { name: b.name })
    $('dTime').textContent = dayText(b) + ' ' + rangeText(b.time, b.minutes || st.data.slotMinutes)
    $('dPay').textContent = payLabel(PAYS[st.pay].key)
    $('dAddr').innerHTML = esc(shop.address) + '<br>' + esc(shop.doorNumber)
    $('confirm').style.display = 'none'; $('done').style.display = ''
  }).catch(function (err) {
    showToast(err.message)
    st.submitting = false
    closeSheet()
    setTimeout(load, 500)
  }).then(function () {
    st.submitting = false
    $('submit').textContent = t('submit')
  })
}

function copyAddress() { copyText(st.data.shop.address + ', ' + st.data.shop.doorNumber, t('addrCopied')) }

// 换了设备或清了浏览器数据时，用手机号找回自己的预约
function findMine() {
  showModal({
    title: t('findTitle'), content: t('findBody'), input: t('phonePh'), inputType: 'tel', inputMode: 'tel', confirmText: t('find'),
    onConfirm: function (v) {
      if (String(v || '').replace(/\D/g, '').length < 10) return showToast(t('needPhone'))
      memory.set('phone', v.trim())
      $('phone').value = v.trim()
      load().then(function () {
        showToast(st.data.myBookings.length ? t('found', { n: st.data.myBookings.length }) : t('notFound'))
        window.scrollTo({ top: 0, behavior: 'smooth' })
      })
    }
  })
}

// ---------- 绑定事件 ----------
applyI18n()
document.title = t('pageTitle')
$('langBtn').textContent = t('langBtn')
$('langBtn').onclick = function () { setLang(LANG === 'en' ? 'zh' : 'en') }

$('name').value = memory.get('name')
$('phone').value = memory.get('phone')
st.pay = Math.max(0, PAYS.findIndex(function (p) { return p.key === memory.get('payment') }))

document.querySelectorAll('#paySeg .seg-item').forEach(function (el) {
  press(el, 'seg-pressed')
  el.onclick = function () {
    st.pay = Number(el.dataset.p)
    $('payInd').style.transform = 'translateX(' + st.pay * 100 + '%)'
    document.querySelectorAll('#paySeg .seg-item').forEach(function (s, j) { s.classList.toggle('seg-on', j === st.pay) })
    $('zelle').classList.toggle('zelle-show', st.pay === 1)
  }
})
$('payInd').style.transform = 'translateX(' + st.pay * 100 + '%)'
document.querySelectorAll('#paySeg .seg-item').forEach(function (s, j) { s.classList.toggle('seg-on', j === st.pay) })
$('zelle').classList.toggle('zelle-show', st.pay === 1)

;['addrRow', 'wechatRow', 'zelleRow', 'phoneRow'].forEach(function (id) { press($(id), 'row-pressed') })
$('addrRow').onclick = copyAddress
$('wechatRow').onclick = function () { copyText(st.data.shop.wechat, t('wechatCopied')) }
$('zelleRow').onclick = function () { copyText(st.data.shop.zelle, t('zelleCopied')) }
$('findMine').onclick = findMine
document.querySelectorAll('.btn-primary').forEach(function (el) { press(el, 'btn-pressed') })
$('book').onclick = openSheet
$('mask').onclick = closeSheet
$('later').onclick = closeSheet
$('submit').onclick = submit
$('finish').onclick = function () {
  $('sheet').classList.remove('sheet-open')
  setTimeout(function () { $('sheet').style.display = 'none'; load() }, 500)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// 大标题滚出去后，顶部导航栏变成毛玻璃并显示小标题
new IntersectionObserver(function (e) { $('nav').classList.toggle('nav-collapsed', !e[0].isIntersecting) }, { rootMargin: '-44px 0px 0px 0px' }).observe($('title'))

// 演示模式下，店主入口也带上 ?demo=1
if (SAM_DEMO && location.search) $('adminLink').href = 'admin.html' + location.search
showDemoBanner()
load()
