// 店主后台：密码登录、即将到来 / 历史记录、今日收入、记小费、取消、营业设置
var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
var PAY = { cash: '现金', zelle: 'Zelle' }
var TIP_PRESETS = [5, 10, 15, 20]
var HOURS = Array.from({ length: 16 }, function (_, i) { return pad2(i + 8) })   // 08–23
var MINUTES = Array.from({ length: 60 }, function (_, i) { return pad2(i) })
var ad = { pw: memory.get('admin-pw'), scope: 0, data: null }

function sum(items, f) { return items.reduce(function (s, b) { return s + f(b) }, 0) }

function login(pw) {
  return api('adminLogin', { password: pw }).then(function () {
    ad.pw = pw
    memory.set('admin-pw', pw)
    $('login').style.display = 'none'
    $('main').style.display = ''
    return load()
  })
}

function showLogin(msg) {
  $('main').style.display = 'none'
  $('login').style.display = ''
  if (msg) showToast(msg)
}

function load() {
  $('list').classList.add('dim')
  return api('adminList', { password: ad.pw, scope: ad.scope === 0 ? 'upcoming' : 'past' }).then(function (res) {
    ad.data = res
    render()
  }).catch(function (err) {
    if (/密码/.test(err.message)) { memory.del('admin-pw'); showLogin(err.message) } else showToast(err.message)
  }).then(function () { $('list').classList.remove('dim') })
}

function render() {
  var d = ad.data, items = d.bookings
  // 统计卡片
  $('sTotal').textContent = items.length
  $('sCash').textContent = items.filter(function (b) { return b.payment === 'cash' }).length
  $('sZelle').textContent = items.filter(function (b) { return b.payment === 'zelle' }).length
  // 收入卡片：即将到来里算今天，历史记录里算全部
  var inc = ad.scope === 0 ? items.filter(function (b) { return b.date === d.today }) : items
  var amt = function (b) { return b.price + b.tip }
  $('iTitle').textContent = ad.scope === 0 ? '今日收入' : '历史收入'
  $('iDate').textContent = ad.scope === 0 ? dateLabel(d.today) + ' · ' + (inc.length ? inc.length + ' 位客人' : '今天没有预约') : '共 ' + inc.length + ' 位客人'
  $('iTotal').textContent = money(sum(inc, amt))
  $('iBreak').textContent = '服务 ' + money(sum(inc, function (b) { return b.price })) + ' · 小费 ' + money(sum(inc, function (b) { return b.tip }))
  $('iCash').textContent = money(sum(inc.filter(function (b) { return b.payment === 'cash' }), amt))
  $('iZelle').textContent = money(sum(inc.filter(function (b) { return b.payment === 'zelle' }), amt))

  // 按日期分组的客户列表
  var groups = []
  items.forEach(function (b) {
    var g = groups[groups.length - 1]
    if (!g || g.date !== b.date) groups.push(g = { date: b.date, weekday: b.weekday, items: [] })
    g.items.push(b)
  })
  $('list').innerHTML = !groups.length
    ? '<div class="empty"><div class="empty-title">' + (ad.scope === 0 ? '暂时没有预约' : '还没有历史记录') + '</div><div class="empty-sub">' + (ad.scope === 0 ? '有人预约时你会收到邮件' : '理完发的预约会出现在这里') + '</div></div>'
    : groups.map(function (g) {
      return '<div class="section-header"><span class="day">' + dateLabel(g.date) + ' ' + g.weekday + '</span>' +
        '<span class="day-meta">' + g.items.length + ' 位 · 现金 ' + g.items.filter(function (b) { return b.payment === 'cash' }).length +
        ' · Zelle ' + g.items.filter(function (b) { return b.payment === 'zelle' }).length + ' · <span class="day-sum">' + money(sum(g.items, amt)) + '</span></span></div>' +
        '<div class="group">' + g.items.map(function (b) {
          return '<div class="row customer">' +
            '<div class="when"><div class="time">' + b.time + '</div><div class="end">' + addMinutes(b.time, d.slotMinutes) + '</div></div>' +
            '<a class="who" href="tel:+' + b.phone + '" style="color:inherit;text-decoration:none"><div class="who-col"><div class="who-line"><div class="name">' + esc(b.name) + '</div><div class="pay pay-' + b.payment + '">' + PAY[b.payment] + '</div></div><div class="who-phone">' + prettyPhone(b.phone) + '</div></div></a>' +
            '<div class="amount" data-id="' + b.id + '"><div class="amount-num">' + money(amt(b)) + '</div>' + (b.tip ? '<div class="amount-tip">小费 ' + money(b.tip) + '</div>' : '<div class="amount-add">+ 小费</div>') + '</div>' +
            (ad.scope === 0 ? '<div class="del" data-id="' + b.id + '">取消</div>' : '') +
            '</div>'
        }).join('') + '</div>'
    }).join('')

  var byId = function (id) { return items.filter(function (b) { return b.id === id })[0] }
  $('list').querySelectorAll('.amount').forEach(function (el) {
    press(el, 'amount-pressed')
    el.onclick = function () { editTip(byId(el.dataset.id)) }
  })
  $('list').querySelectorAll('.del').forEach(function (el) {
    press(el, 'del-pressed')
    el.onclick = function () {
      var b = byId(el.dataset.id)
      showModal({
        title: '取消 ' + b.name + ' 的预约？', content: '取消后这个时间会重新开放。', confirmText: '取消预约', cancelText: '保留', danger: true,
        onConfirm: function () {
          api('adminCancel', { password: ad.pw, id: b.id }).then(function () { showToast('已取消'); load() }).catch(function (err) { showToast(err.message) })
        }
      })
    }
  })

  // 营业设置（只在“即将到来”里显示）
  $('settings').style.display = ad.scope === 0 ? '' : 'none'
  $('weekdayVal').textContent = WEEKDAYS[d.settings.openWeekday]
  $('startVal').textContent = d.settings.startTime
  $('endVal').textContent = d.settings.endTime
}

function editTip(b) {
  var items = TIP_PRESETS.map(function (n) { return '$' + n }).concat('其他金额')
  if (b.tip) items.push('清除小费')
  var save = function (tip) {
    api('setTip', { password: ad.pw, id: b.id, tip: tip }).then(function () {
      showToast(tip ? '已记小费 ' + money(tip) : '已清除小费'); load()
    }).catch(function (err) { showToast(err.message) })
  }
  showActionSheet({
    title: b.name + ' 的小费', items: items, dangerIndex: b.tip ? items.length - 1 : -1,
    onPick: function (i) {
      if (i < TIP_PRESETS.length) return save(TIP_PRESETS[i])
      if (items[i] === '清除小费') return save(0)
      showModal({
        title: b.name + ' 的小费', input: '输入金额，例如 8', inputMode: 'decimal', confirmText: '保存',
        onConfirm: function (v) {
          var n = Number(String(v).replace(/[$\s]/g, ''))
          if (!(n >= 0)) return showToast('请输入数字')
          save(n)
        }
      })
    }
  })
}

function saveSettings(patch, msg) {
  api('setSettings', Object.assign({ password: ad.pw }, patch)).then(function () { showToast(msg); load() })
    .catch(function (err) { showToast(err.message) })
}

function openTimeWheel(title, value, key, verb) {
  var p = value.split(':')
  openWheel({
    title: title, separator: ':',
    columns: [{ items: HOURS, index: HOURS.indexOf(p[0]) }, { items: MINUTES, index: MINUTES.indexOf(p[1]) }],
    onConfirm: function (sel) {
      var t = HOURS[sel[0]] + ':' + MINUTES[sel[1]]
      var patch = {}; patch[key] = t
      saveSettings(patch, '改为 ' + t + ' ' + verb)
    }
  })
}

// ---------- 绑定事件 ----------
document.querySelectorAll('.seg-item[data-s]').forEach(function (el) {
  press(el, 'seg-pressed')
  el.onclick = function () {
    var s = Number(el.dataset.s)
    if (s === ad.scope) return
    ad.scope = s
    $('ind').style.transform = 'translateX(' + s * 100 + '%)'
    document.querySelectorAll('.seg-item[data-s]').forEach(function (x, j) { x.classList.toggle('seg-on', j === s) })
    load()
  }
})
;['weekdayRow', 'startRow', 'endRow'].forEach(function (id) { press($(id), 'row-pressed') })
$('weekdayRow').onclick = function () {
  openWheel({
    title: '每周营业日', columns: [{ items: WEEKDAYS, index: ad.data.settings.openWeekday }],
    onConfirm: function (sel) { saveSettings({ openWeekday: sel[0] }, '营业日已改为' + WEEKDAYS[sel[0]]) }
  })
}
$('startRow').onclick = function () { openTimeWheel('几点开始', ad.data.settings.startTime, 'startTime', '开始') }
$('endRow').onclick = function () { openTimeWheel('几点结束', ad.data.settings.endTime, 'endTime', '结束') }
press($('loginBtn'), 'btn-pressed')
$('loginBtn').onclick = function () {
  var pw = $('pw').value.trim()
  if (!pw) return showToast('请输入密码')
  login(pw).catch(function (err) { showToast(err.message) })
}
$('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('loginBtn').click() })
$('logout').onclick = function () { memory.del('admin-pw'); ad.pw = ''; $('pw').value = ''; showLogin('已退出') }

if (SAM_DEMO) $('pwHint').textContent = '演示模式的密码是 1234。正式启用后，密码会在部署后台时发到你的 Gmail。'
showDemoBanner()
if (ad.pw) login(ad.pw).catch(function () { memory.del('admin-pw'); showLogin() })
else showLogin()
