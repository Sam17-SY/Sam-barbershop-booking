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
    if (!res.schedule) throw new Error('Google 后台还是旧版本，请按 DEPLOY.md 更新后台代码并部署新版本')
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
            '<div class="when' + (ad.scope === 0 ? ' when-edit' : '') + '" data-id="' + b.id + '"><div class="time">' + b.time + '</div><div class="end">' + addMinutes(b.time, b.minutes) + '</div></div>' +
            '<a class="who" href="tel:+' + b.phone + '" style="color:inherit;text-decoration:none"><div class="who-col"><div class="who-line"><div class="name">' + esc(b.name) + '</div><div class="pay pay-' + b.payment + '">' + PAY[b.payment] + '</div></div><div class="who-phone">' + prettyPhone(b.phone) + (b.email ? ' · ' + esc(b.email) : '') + '</div></div></a>' +
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
          api('adminCancel', { password: ad.pw, id: b.id }).then(function (res) {
            load()
            offerSms(b, '已取消 ' + b.name + ' 的预约', res.emailed,
              'Sam Barbershop：抱歉，你 ' + dateLabel(b.date) + '（' + b.weekday + '）' + b.time + ' 的理发预约已取消。可以重新预约：' + siteUrl() +
              '\n\nSorry, your haircut at Sam Barbershop on ' + enWhen(b.date, b.time) + ' has been cancelled. Book a new time: ' + siteUrl())
          }).catch(function (err) { showToast(err.message) })
        }
      })
    }
  })

  // 点客人左边的时间：帮他改时间
  $('list').querySelectorAll('.when-edit').forEach(function (el) {
    press(el, 'when-pressed')
    el.onclick = function () { moveBooking(byId(el.dataset.id)) }
  })

  // 营业设置和“接下来的营业日”（只在“即将到来”里显示）
  $('settings').style.display = ad.scope === 0 ? '' : 'none'
  $('weekdayVal').textContent = d.settings.openWeekdays.map(function (n) { return WEEKDAYS[n] }).join('、')
  $('startVal').textContent = d.settings.startTime
  $('endVal').textContent = d.settings.endTime
  $('lenVal').textContent = d.settings.slotMinutes + ' 分钟'
  renderSchedule()
}

function renderSchedule() {
  var days = ad.data.schedule
  $('schedule').innerHTML = !days.length
    ? '<div class="row"><div class="row-label" style="color:var(--secondary)">接下来两周没有营业日</div></div>'
    : days.map(function (day, i) {
      var info = day.closed ? '<span class="tag-closed">休息</span>'
        : (day.count ? day.count + ' 位预约' : '还没有预约') + (day.blocked.length ? ' · 锁住 ' + day.blocked.length + ' 个时段' : '')
      return '<div class="row' + (i ? ' row-sep' : '') + '" data-i="' + i + '"><div class="row-label">' + dateLabel(day.date) + ' ' + day.weekday + '</div><div class="row-value">' + info + '</div><div class="chevron"></div></div>'
    }).join('')
  $('schedule').querySelectorAll('.row[data-i]').forEach(function (el) {
    press(el, 'row-pressed')
    el.onclick = function () { dayMenu(days[Number(el.dataset.i)]) }
  })
}

// 某一天的菜单：临时休息 / 恢复营业、锁住或解锁时段
function dayMenu(day) {
  var title = dateLabel(day.date) + ' ' + day.weekday
  var items = day.closed ? ['恢复营业'] : ['这天休息', '锁住 / 解锁时段']
  showActionSheet({
    title: title + (day.closed ? '（休息中）' : ''), items: items, dangerIndex: day.closed ? -1 : 0,
    onPick: function (i) {
      if (day.closed) return setClosed(day, false)
      if (i === 0) {
        showModal({
          title: title + ' 休息？',
          content: day.count ? '这天已经有 ' + day.count + ' 位客人预约，他们不会被自动取消，记得联系他们改时间或在列表里取消。' : '顾客将约不了这一天。',
          confirmText: '这天休息', danger: true, onConfirm: function () { setClosed(day, true) }
        })
      } else lockMenu(day)
    }
  })
}

function setClosed(day, closed) {
  api('setDayClosed', { password: ad.pw, date: day.date, closed: closed }).then(function () {
    showToast(closed ? dateLabel(day.date) + ' 已设为休息' : dateLabel(day.date) + ' 恢复营业'); load()
  }).catch(function (err) { showToast(err.message) })
}

// 锁住 / 解锁时段：列出这一天所有时段，点一下切换
function lockMenu(day) {
  api('adminSlots', { password: ad.pw, date: day.date }).then(function (res) {
    var labels = { free: '可约', taken: '已有预约', blocked: '🔒 已锁住', past: '已过' }
    var items = res.slots.map(function (s) { return s.time + '　' + labels[s.state] })
    var muted = res.slots.map(function (s, i) { return s.state === 'taken' || s.state === 'past' ? i : -1 }).filter(function (i) { return i >= 0 })
    showActionSheet({
      title: dateLabel(day.date) + ' · 点时段锁住或解锁', items: items, mutedIndexes: muted,
      onPick: function (i) {
        var s = res.slots[i]
        if (s.state === 'taken') return showToast('这个时段已经有预约了')
        if (s.state === 'past') return showToast('这个时间已经过了')
        api('toggleBlock', { password: ad.pw, date: day.date, time: s.time }).then(function (r) {
          showToast(r.locked ? s.time + ' 已锁住' : s.time + ' 已解锁'); load()
        }).catch(function (err) { showToast(err.message) })
      }
    })
  }).catch(function (err) { showToast(err.message) })
}

// 帮客人改时间：先选日期，再选这天还空着的时段
function moveBooking(b) {
  var days = ad.data.schedule.filter(function (d) { return !d.closed })
  if (!days.length) return showToast('接下来没有营业日')
  showActionSheet({
    title: '把 ' + b.name + ' 改到哪一天？（现在 ' + dateLabel(b.date) + ' ' + b.time + '）',
    items: days.map(function (d) { return dateLabel(d.date) + ' ' + d.weekday }),
    onPick: function (i) {
      var day = days[i]
      api('adminSlots', { password: ad.pw, date: day.date, exceptId: b.id }).then(function (res) {
        var free = res.slots.filter(function (s) { return s.state === 'free' && !(day.date === b.date && s.time === b.time) })
        if (!free.length) return showToast('这天没有空的时段了')
        showActionSheet({
          title: dateLabel(day.date) + ' ' + day.weekday + ' 还空着的时段', items: free.map(function (s) { return s.time }),
          onPick: function (j) {
            var t = free[j].time
            api('adminMove', { password: ad.pw, id: b.id, date: day.date, time: t }).then(function (res) {
              load()
              offerSms(b, '已把 ' + b.name + ' 改到 ' + dateLabel(day.date) + ' ' + t, res.emailed,
                'Sam Barbershop：你的理发预约改到了 ' + dateLabel(day.date) + '（' + day.weekday + '）' + t + '。有问题可以回复这条短信。' +
                '\n\nYour haircut at Sam Barbershop has been moved to ' + enWhen(day.date, t) + '. Reply here if that doesn’t work for you.')
            }).catch(function (err) { showToast(err.message) })
          }
        })
      }).catch(function (err) { showToast(err.message) })
    }
  })
}

// ---------- 通知客人：取消或改时间后，一键打开手机短信，内容（中英双语）已经写好 ----------
var EN_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
var EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function enWhen(date, time) {
  var p = date.split('-').map(Number), h = Number(time.slice(0, 2))
  return EN_WD[new Date(date + 'T00:00:00Z').getUTCDay()] + ', ' + EN_MON[p[1] - 1] + ' ' + p[2] + ' at ' + (h % 12 || 12) + ':' + time.slice(3) + ' ' + (h < 12 ? 'AM' : 'PM')
}
function siteUrl() { return SAM_DEMO ? location.href.replace(/admin\.html.*$/, '') : SAM_DEFAULT_CONFIG.siteUrl }

function offerSms(b, title, emailed, text) {
  showModal({
    title: title,
    content: (emailed ? '已经自动发邮件通知了 ' + b.name + '。' : b.name + ' 没有留邮箱，收不到自动通知。') + '要再发一条短信吗？内容已经写好，你只需要按发送。',
    confirmText: '发短信', cancelText: '不用了',
    onConfirm: function () { location.href = 'sms:+' + b.phone + '?&body=' + encodeURIComponent(text) }
  })
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
;['weekdayRow', 'startRow', 'endRow', 'lenRow'].forEach(function (id) { press($(id), 'row-pressed') })
// 每周营业日：可以多选
$('weekdayRow').onclick = function () {
  showChecklist({
    title: '每周营业日（可多选）', items: WEEKDAYS, selected: ad.data.settings.openWeekdays,
    onConfirm: function (days) {
      if (!days.length) return showToast('至少要选一天营业')
      saveSettings({ openWeekdays: days }, '营业日：' + days.map(function (n) { return WEEKDAYS[n] }).join('、'))
    }
  })
}
// 每位客人时长
$('lenRow').onclick = function () {
  var opts = ad.data.slotOptions
  showActionSheet({
    title: '每位客人多长时间？（只影响之后的新预约）', items: opts.map(function (n) { return n + ' 分钟' + (n === ad.data.settings.slotMinutes ? '（现在）' : '') }),
    onPick: function (i) { saveSettings({ slotMinutes: opts[i] }, '每位改为 ' + opts[i] + ' 分钟') }
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

if (SAM_DEMO && location.search) document.querySelector('.native-back').href = 'index.html' + location.search
if (SAM_DEMO) $('pwHint').textContent = '演示模式的密码是 1234。正式启用后，密码会在部署后台时发到你的 Gmail。'
showDemoBanner()
if (ad.pw) login(ad.pw).catch(function () { memory.del('admin-pw'); showLogin() })
else showLogin()
