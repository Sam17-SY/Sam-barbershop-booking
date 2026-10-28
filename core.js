// 网页版预约系统的核心规则。
// 同一份代码跑在两个地方：Google Apps Script（正式后台，数据存 Google 表格）和浏览器（演示模式，数据存本机）。
// 规则：店主选每周营业哪几天、几点到几点、每位多长时间；同一个手机号每周（周一到周日）只能约一次；
// 同一时段不会被两个人约到；店主可以临时休息某一天、锁住某个时段、帮客人改时间。

var SAM_DEFAULT_CONFIG = {
  shop: {
    name: 'Sam Barbershop',
    city: 'Savannah, GA',
    address: '100 Town Center Dr, Savannah, GA',
    doorNumber: 'Apartment 2308',
    wechat: '13110987920',
    phone: '+1 912-703-8740',
    zelle: '+1 912-703-8740'
  },
  // 默认每周营业哪几天：0=周日 1=周一 … 6=周六；店主可在后台改
  openWeekdays: [0],
  startTime: '14:00',
  endTime: '23:00',
  earliestStart: '08:00',
  latestEnd: '23:45',
  // 每位客人的时长（分钟），店主可在后台从 slotOptions 里选
  slotMinutes: 45,
  slotOptions: [20, 30, 40, 45, 50, 60, 75, 90],
  // 顾客能看到今天起多少天内的营业日，最多显示几天
  daysAhead: 14,
  maxDates: 6,
  // 每次理发的价格（美元），预约时记在这条预约上；小费由店主在后台加
  price: 35,
  // 预约网页的网址（发给客人的邮件和短信里用）
  siteUrl: 'https://sam17-sy.github.io/Sam-barbershop-booking/'
}

// store 需要提供：listBookings() addBooking(b) updateBooking(id, patch) getSettings() saveSettings(s)
//               now() → { date: 'YYYY-MM-DD', minutes }（店铺当地时间） lock(fn) checkPassword(pw)
//               sendMail(subject, text, to)：不传 to 时发给店主；传了就发给这位客人
function createSamBackend(cfg, store) {
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  var WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  var PAYMENTS = { cash: '现金', zelle: 'Zelle' }

  function pad(n) { return (n < 10 ? '0' : '') + n }
  function toMinutes(t) { var p = String(t).split(':'); return Number(p[0]) * 60 + Number(p[1]) }
  function fromMinutes(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60) }
  function addDays(date, n) {
    var d = new Date(date + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  function weekdayIndex(date) { return new Date(date + 'T00:00:00Z').getUTCDay() }
  function weekdayOf(date) { return WEEKDAYS[weekdayIndex(date)] }
  // 这一周的周一（“每人每周一次”按周一到周日算）
  function weekOf(date) { return addDays(date, -((weekdayIndex(date) + 6) % 7)) }
  function isHHMM(t) { return typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) }
  function isDate(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) }
  function label(date) { var p = date.split('-'); return Number(p[1]) + '月' + Number(p[2]) + '日（' + weekdayOf(date) + '）' }

  // 开始和结束时间互相制约：中间至少要能排下一位客人
  function validHours(start, end, minutes) {
    if (!isHHMM(start) || !isHHMM(end)) return false
    return toMinutes(start) >= toMinutes(cfg.earliestStart) && toMinutes(end) <= toMinutes(cfg.latestEnd) &&
      toMinutes(start) + minutes <= toMinutes(end)
  }

  function timeBounds(s) {
    return {
      earliestStart: cfg.earliestStart,
      latestStart: fromMinutes(toMinutes(s.endTime) - s.slotMinutes),
      earliestEnd: fromMinutes(toMinutes(s.startTime) + s.slotMinutes),
      latestEnd: cfg.latestEnd,
      slotOptions: cfg.slotOptions
    }
  }

  function cleanWeekdays(list) {
    if (!Array.isArray(list)) return null
    var out = []
    list.forEach(function (n) { n = Number(n); if (n >= 0 && n <= 6 && out.indexOf(n) < 0) out.push(n) })
    return out.length ? out.sort() : null
  }

  // 读取店主的设置；没设置过的用默认值。过去日期的“休息日”“锁住的时段”自动忽略
  function getSettings() {
    var saved = store.getSettings() || {}
    var today = store.now().date
    var s = { openWeekdays: cfg.openWeekdays.slice(), startTime: cfg.startTime, endTime: cfg.endTime, slotMinutes: cfg.slotMinutes, closedDates: [], blocked: [] }
    // 旧版只存了一个 openWeekday
    var days = cleanWeekdays(saved.openWeekdays) || (typeof saved.openWeekday === 'number' ? [saved.openWeekday] : null)
    if (days) s.openWeekdays = days
    if (cfg.slotOptions.indexOf(Number(saved.slotMinutes)) >= 0) s.slotMinutes = Number(saved.slotMinutes)
    var start = saved.startTime || s.startTime
    var end = saved.endTime || s.endTime
    if (validHours(start, end, s.slotMinutes)) { s.startTime = start; s.endTime = end }
    if (Array.isArray(saved.closedDates)) s.closedDates = saved.closedDates.filter(function (d) { return isDate(d) && d >= today })
    if (Array.isArray(saved.blocked)) {
      s.blocked = saved.blocked.filter(function (b) { return b && isDate(b.date) && isHHMM(b.time) && b.date >= today })
        .map(function (b) { return { date: b.date, time: b.time, minutes: Number(b.minutes) || s.slotMinutes } })
    }
    return s
  }

  function allSlots(s) {
    var slots = []
    for (var t = toMinutes(s.startTime); t + s.slotMinutes <= toMinutes(s.endTime); t += s.slotMinutes) slots.push(fromMinutes(t))
    return slots
  }

  // 接下来的营业日（每周营业的那几天）。includeClosed 为 true 时，店主临时休息的日子也列出来（店主后台用）
  function openDates(s, includeClosed) {
    var today = store.now().date
    var dates = []
    for (var i = 0; i < cfg.daysAhead && dates.length < cfg.maxDates; i++) {
      var d = addDays(today, i)
      if (s.openWeekdays.indexOf(weekdayIndex(d)) < 0) continue
      if (!includeClosed && s.closedDates.indexOf(d) >= 0) continue
      dates.push(d)
    }
    return dates
  }

  function isPast(date, time) {
    var now = store.now()
    if (date !== now.date) return date < now.date
    return toMinutes(time) <= now.minutes
  }

  function minutesOf(b) { return Number(b.minutes) || cfg.slotMinutes }

  // 两段时间是否重叠（每个预约按自己的时长算，改过时长也不会算错）
  function clash(list, date, time, minutes, exceptId) {
    var a = toMinutes(time), aEnd = a + minutes
    return list.some(function (b) {
      if (b.date !== date || (exceptId && b.id === exceptId)) return false
      var c = toMinutes(b.time)
      return a < c + minutesOf(b) && c < aEnd
    })
  }

  // 某个时段的状态：free 可约 / taken 有人约了 / blocked 店主锁住了 / past 已经过了
  function slotState(s, active, date, time, exceptId) {
    if (isPast(date, time)) return 'past'
    if (clash(s.blocked, date, time, s.slotMinutes)) return 'blocked'
    if (clash(active, date, time, s.slotMinutes, exceptId)) return 'taken'
    return 'free'
  }

  // 手机号只留数字；10 位的美国号码自动补上国家码 1
  function normPhone(p) {
    var d = String(p || '').replace(/\D/g, '')
    if (d.length === 10) d = '1' + d
    return d
  }

  function activeBookings() {
    return store.listBookings().filter(function (b) { return b.status === 'booked' })
  }

  function findActive(id) {
    return activeBookings().filter(function (x) { return x.id === id })[0]
  }

  function money(n) { return '$' + (n % 1 ? n.toFixed(2) : n) }

  // 给顾客看的预约信息（不带手机号）
  function publicBooking(b) {
    return { id: b.id, date: b.date, time: b.time, minutes: minutesOf(b), name: b.name, payment: b.payment, price: Number(b.price) || 0, weekday: weekdayOf(b.date) }
  }

  function adminBooking(b) {
    var o = publicBooking(b)
    o.phone = b.phone
    o.tip = Number(b.tip) || 0
    o.email = b.email || ''
    return o
  }

  function bookingText(b) {
    return [
      '客户名称：' + b.name,
      '手机号：+' + b.phone,
      '时间：' + b.date + '（' + weekdayOf(b.date) + '）' + b.time + '，' + minutesOf(b) + ' 分钟',
      '付款方式：' + (PAYMENTS[b.payment] || '未选择') + '（' + money(Number(b.price) || 0) + '）',
      '地址：' + cfg.shop.address + ' ' + cfg.shop.doorNumber
    ].join('\n')
  }

  // 给客人的邮件（中英双语）：booked 预约成功 / cancelled 店主取消 / moved 店主改了时间
  function enWhen(b) {
    var p = b.date.split('-').map(Number), m = toMinutes(b.time)
    var h = Math.floor(m / 60) % 12 || 12
    return WEEKDAYS_EN[weekdayIndex(b.date)] + ', ' + MONTHS_EN[p[1] - 1] + ' ' + p[2] + ' at ' + h + ':' + pad(m % 60) + ' ' + (m < 720 ? 'AM' : 'PM')
  }
  function mailCustomer(b, kind, old) {
    if (!b.email) return false
    var zh = label(b.date) + ' ' + b.time, en = enWhen(b)
    var addr = cfg.shop.address + ', ' + cfg.shop.doorNumber
    var site = cfg.siteUrl || ''
    var t = kind === 'booked'
      ? ['预约成功 / You’re booked', '你好 ' + b.name + '，你在 ' + cfg.shop.name + ' 的理发预约成功了：' + zh + '。\n地址：' + addr,
        'Hi ' + b.name + ', your haircut at ' + cfg.shop.name + ' is booked for ' + en + '.\nAddress: ' + addr]
      : kind === 'cancelled'
      ? ['预约已取消 / Booking cancelled', '你好 ' + b.name + '，抱歉，你 ' + zh + ' 的理发预约被店主取消了。' + (site ? '\n可以重新预约：' + site : ''),
        'Hi ' + b.name + ', sorry — your haircut on ' + en + ' was cancelled by the barber.' + (site ? '\nBook a new time: ' + site : '')]
      : ['预约时间有变 / Your booking time changed', '你好 ' + b.name + '，店主把你的理发预约从 ' + label(old.date) + ' ' + old.time + ' 改到了 ' + zh + '。\n地址：' + addr,
        'Hi ' + b.name + ', the barber moved your haircut from ' + enWhen(old) + ' to ' + en + '.\nAddress: ' + addr]
    var footer = '\n\n有问题请联系店主 / Questions? Contact the barber: ' + cfg.shop.phone + '（微信 WeChat ' + cfg.shop.wechat + '）'
    store.sendMail('[' + cfg.shop.name + '] ' + t[0], t[1] + '\n\n' + t[2] + footer, b.email, mailHtml(b, kind, old))
    return true
  }

  // 邮件的网页版排版（手机邮箱里显示成一张卡片；看不了网页格式的邮箱会显示上面的纯文字）
  function enDate(date) { var p = date.split('-').map(Number); return WEEKDAYS_EN[weekdayIndex(date)] + ', ' + MONTHS_EN[p[1] - 1] + ' ' + p[2] }
  function enTime(hhmm) { var m = toMinutes(hhmm); return (Math.floor(m / 60) % 12 || 12) + ':' + pad(m % 60) + ' ' + (m < 720 ? 'AM' : 'PM') }
  function h(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }

  function mailHtml(b, kind, old) {
    var shop = cfg.shop, site = cfg.siteUrl || ''
    var FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Helvetica,Arial,sans-serif"
    var INK = '#1c2541', MUTED = '#6b7385', BLUE = '#2b59c3', RED = '#d0312d', SOFT = '#f4f6fb'
    var end = fromMinutes(toMinutes(b.time) + minutesOf(b))
    var head = {
      booked: { color: BLUE, zh: '预约成功', en: 'You’re booked', hiZh: '你好 ' + h(b.name) + '，到时见！', hiEn: 'Hi ' + h(b.name) + ', see you soon!' },
      cancelled: { color: RED, zh: '预约已取消', en: 'Booking cancelled', hiZh: '你好 ' + h(b.name) + '，抱歉，预约被店主取消了。', hiEn: 'Hi ' + h(b.name) + ', sorry — the barber had to cancel this booking.' },
      moved: { color: BLUE, zh: '预约时间有变', en: 'New time for your haircut', hiZh: '你好 ' + h(b.name) + '，店主帮你换了一个时间。', hiEn: 'Hi ' + h(b.name) + ', the barber moved your booking.' }
    }[kind]
    var gone = kind === 'cancelled' ? 'text-decoration:line-through;color:' + MUTED + ';' : ''

    function row(zhLabel, enLabel, main, sub, first) {
      return '<tr><td style="padding:14px 0;' + (first ? '' : 'border-top:1px solid #e3e7f0;') + 'vertical-align:top;width:72px;font-size:13px;line-height:18px;color:' + MUTED + ';">' + zhLabel + '<br>' + enLabel + '</td>' +
        '<td style="padding:14px 0;' + (first ? '' : 'border-top:1px solid #e3e7f0;') + 'vertical-align:top;">' +
        '<div style="font-size:17px;line-height:24px;font-weight:600;color:' + INK + ';' + gone + '">' + main + '</div>' +
        (sub ? '<div style="font-size:14px;line-height:20px;color:' + MUTED + ';' + gone + '">' + sub + '</div>' : '') + '</td></tr>'
    }

    var zhDate = function (d) { var p = d.split('-'); return Number(p[1]) + '月' + Number(p[2]) + '日 ' + weekdayOf(d) }
    var rows = row('日期', 'Date', zhDate(b.date), enDate(b.date), true) +
      row('时间', 'Time', b.time + ' – ' + end, enTime(b.time) + ' – ' + enTime(end))
    if (kind === 'moved') rows += row('原来', 'Was', '<span style="text-decoration:line-through;color:' + MUTED + ';font-weight:400;">' + zhDate(old.date) + ' ' + old.time + '</span>', '<span style="text-decoration:line-through;">' + enDate(old.date) + ' ' + enTime(old.time) + '</span>')
    if (kind !== 'cancelled') {
      rows += row('付款', 'Payment', (PAYMENTS[b.payment] || '') + ' · ' + money(Number(b.price) || 0), b.payment === 'zelle' ? 'Zelle ' + h(shop.zelle) : 'Cash')
      rows += row('地址', 'Address', '<a href="https://maps.google.com/?q=' + encodeURIComponent(shop.address) + '" style="color:' + INK + ';text-decoration:none;">' + h(shop.address) + '</a>', h(shop.doorNumber))
    }

    var btn = site ? '<tr><td align="center" style="padding:8px 28px 28px;"><a href="' + h(site) + '" style="display:inline-block;padding:14px 32px;border-radius:999px;background:' + INK + ';color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">' +
      (kind === 'cancelled' ? '重新预约 · Book again' : '查看我的预约 · View booking') + '</a></td></tr>' : ''

    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="format-detection" content="telephone=no,date=no,address=no"></head>' +
      '<body style="margin:0;padding:0;background:' + SOFT + ';">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + SOFT + ';font-family:' + FONT + ';"><tr><td align="center" style="padding:24px 12px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;">' +
      // 顶部理发店灯柱条纹
      '<tr><td style="height:8px;line-height:8px;font-size:0;background:' + BLUE + ';background-image:repeating-linear-gradient(135deg,' + RED + ' 0 14px,#ffffff 14px 28px,' + BLUE + ' 28px 42px,#ffffff 42px 56px);">&nbsp;</td></tr>' +
      '<tr><td align="center" style="padding:28px 28px 4px;"><img src="' + h(site) + 'images/logo-badge.png" width="128" height="128" alt="' + h(shop.name) + '" style="display:block;width:128px;height:128px;border:0;"></td></tr>' +
      '<tr><td align="center" style="padding:8px 28px 0;"><div style="font-size:26px;line-height:34px;font-weight:700;color:' + head.color + ';">' + head.zh + '</div>' +
      '<div style="font-size:15px;line-height:22px;font-weight:600;letter-spacing:.5px;color:' + head.color + ';">' + head.en + '</div></td></tr>' +
      '<tr><td align="center" style="padding:16px 28px 20px;font-size:15px;line-height:22px;color:' + INK + ';">' + head.hiZh + '<br><span style="color:' + MUTED + ';">' + head.hiEn + '</span></td></tr>' +
      '<tr><td style="padding:0 20px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + SOFT + ';border-radius:14px;"><tr><td style="padding:2px 18px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rows + '</table></td></tr></table></td></tr>' +
      btn +
      '<tr><td align="center" style="padding:18px 28px 24px;border-top:1px solid #e3e7f0;font-size:13px;line-height:20px;color:' + MUTED + ';">' +
      '有问题请联系店主 · Questions? Contact the barber<br>' +
      '<a href="tel:' + shop.phone.replace(/[^\d+]/g, '') + '" style="color:' + BLUE + ';text-decoration:none;font-weight:600;">' + h(shop.phone) + '</a>' +
      ' &nbsp;·&nbsp; 微信 WeChat <span style="color:' + INK + ';font-weight:600;">' + h(shop.wechat) + '</span><br>' +
      '<span style="color:#9aa1b1;">' + h(shop.name) + ' · ' + h(shop.city) + '</span></td></tr>' +
      '</table></td></tr></table></body></html>'
  }

  function cleanEmail(e) {
    e = String(e || '').trim()
    if (!e) return ''
    if (e.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('邮箱格式不对')
    return e
  }

  function requireAdmin(data) {
    if (!store.checkPassword(data && data.password)) throw new Error('密码不对')
  }

  // 店主后台里“接下来的营业日”列表：每天有几位预约、是否休息、锁住了哪些时段
  function schedule(s) {
    var active = activeBookings()
    return openDates(s, true).map(function (d) {
      return {
        date: d,
        weekday: weekdayOf(d),
        closed: s.closedDates.indexOf(d) >= 0,
        count: active.filter(function (b) { return b.date === d }).length,
        blocked: s.blocked.filter(function (b) { return b.date === d }).map(function (b) { return b.time })
      }
    })
  }

  function settingsReply(s) {
    var out = timeBounds(s)
    out.settings = s
    out.schedule = schedule(s)
    return out
  }

  var actions = {
    // 顾客页：营业日、时段、店铺信息；带上手机号时顺便返回“我的预约”
    getSlots: function (data) {
      var s = getSettings()
      var dates = openDates(s, false)
      var slots = allSlots(s)
      var active = activeBookings()
      var phone = normPhone(data.phone)
      var today = store.now().date
      var mine = phone ? active.filter(function (b) { return b.phone === phone && b.date >= today }) : []
      // 被店主取消、还没到日子的预约：顾客页提醒一下
      var cancelled = phone ? store.listBookings().filter(function (b) {
        return b.status === 'cancelled' && b.cancelledBy === 'owner' && b.phone === phone && b.date >= today
      }) : []
      return {
        shop: cfg.shop,
        slotMinutes: s.slotMinutes,
        price: cfg.price,
        startTime: s.startTime,
        endTime: s.endTime,
        openWeekdays: s.openWeekdays,
        dates: dates.map(function (date) {
          return {
            date: date,
            weekday: weekdayOf(date),
            bookedByMe: mine.some(function (b) { return weekOf(b.date) === weekOf(date) }),
            slots: slots.map(function (time) { return { time: time, available: slotState(s, active, date, time) === 'free' } })
          }
        }),
        myBookings: mine.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1 }).map(publicBooking),
        cancelledByOwner: cancelled.map(publicBooking)
      }
    },

    book: function (data) {
      var name = String(data.name || '').trim()
      if (!name || name.length > 30) throw new Error('请填写客户名称')
      var phone = normPhone(data.phone)
      if (phone.length < 11 || phone.length > 15) throw new Error('请填写正确的手机号')
      if (!PAYMENTS[data.payment]) throw new Error('请选择付款方式')
      var email = cleanEmail(data.email)
      var date = data.date, time = data.time
      var s = getSettings()
      if (openDates(s, false).indexOf(date) < 0) throw new Error('这一天不能预约')
      if (allSlots(s).indexOf(time) < 0) throw new Error('时间段无效')
      if (isPast(date, time)) throw new Error('这个时间已经过了')

      // 查重和写入放在锁里，两个人同时抢同一个时段，只有一个人能约上
      var booking = store.lock(function () {
        var active = activeBookings()
        if (active.some(function (b) { return b.phone === phone && weekOf(b.date) === weekOf(date) })) throw new Error('这个手机号这周已经预约过了')
        var state = slotState(s, active, date, time)
        if (state === 'blocked') throw new Error('这个时间不开放预约，请换一个')
        if (state !== 'free') throw new Error('这个时间刚被别人约走了，请换一个')
        var b = {
          id: date + '_' + time.replace(':', '') + '_' + Math.random().toString(36).slice(2, 7),
          date: date, time: time, name: name, phone: phone, payment: data.payment,
          price: cfg.price, tip: 0, status: 'booked', createdAt: new Date().toISOString(), cancelledAt: '', minutes: s.slotMinutes,
          email: email, cancelledBy: ''
        }
        store.addBooking(b)
        return b
      })
      store.sendMail('[' + cfg.shop.name + '] 新预约：' + name + ' ' + date + ' ' + time + '（' + PAYMENTS[data.payment] + '）', bookingText(booking))
      mailCustomer(booking, 'booked')
      return { booking: publicBooking(booking), shop: cfg.shop }
    },

    // 顾客自己取消：要输入预约时留的手机号
    cancel: function (data) {
      var phone = normPhone(data.phone)
      var b = findActive(data.id)
      if (!b) throw new Error('这个预约已经取消了，请刷新页面')
      if (b.phone !== phone) throw new Error('手机号和预约时留的不一致')
      if (isPast(b.date, b.time)) throw new Error('预约时间已经到了，不能再取消，请直接联系店主')
      store.updateBooking(b.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'customer' })
      store.sendMail('[' + cfg.shop.name + '] 预约已取消：' + b.name + ' ' + b.date + ' ' + b.time, bookingText(b))
      return { ok: true }
    },

    adminLogin: function (data) {
      requireAdmin(data)
      return { ok: true }
    },

    // scope: 'upcoming' 今天及以后（时间正序），'past' 历史记录（最近的在前）
    adminList: function (data) {
      requireAdmin(data)
      var today = store.now().date
      var past = data.scope === 'past'
      var list = activeBookings().filter(function (b) { return past ? b.date < today : b.date >= today })
      list.sort(function (a, b) {
        if (a.date !== b.date) return (a.date < b.date ? -1 : 1) * (past ? -1 : 1)
        return a.time < b.time ? -1 : 1
      })
      var out = settingsReply(getSettings())
      out.bookings = list.slice(0, past ? 300 : 1000).map(adminBooking)
      out.today = today
      return out
    },

    // 某一天每个时段的状态（店主锁时段、帮客人改时间时用）。exceptId：改时间时不把这位客人自己算作占用
    adminSlots: function (data) {
      requireAdmin(data)
      var s = getSettings()
      if (openDates(s, true).indexOf(data.date) < 0) throw new Error('这一天不营业')
      var active = activeBookings()
      return {
        date: data.date,
        closed: s.closedDates.indexOf(data.date) >= 0,
        slots: allSlots(s).map(function (time) { return { time: time, state: slotState(s, active, data.date, time, data.exceptId) } })
      }
    },

    adminCancel: function (data) {
      requireAdmin(data)
      var b = findActive(data.id)
      if (!b) throw new Error('这个预约已经取消了，请刷新')
      store.updateBooking(b.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'owner' })
      store.sendMail('[' + cfg.shop.name + '] 预约已取消（店主操作）：' + b.name + ' ' + b.date + ' ' + b.time, bookingText(b))
      return { ok: true, emailed: mailCustomer(b, 'cancelled') }
    },

    // 店主帮客人改时间（不用先取消再重新约）
    adminMove: function (data) {
      requireAdmin(data)
      var s = getSettings()
      var date = data.date, time = data.time
      if (openDates(s, false).indexOf(date) < 0) throw new Error('这一天不营业')
      if (allSlots(s).indexOf(time) < 0) throw new Error('时间段无效')
      if (isPast(date, time)) throw new Error('这个时间已经过了')
      var moved = store.lock(function () {
        var active = activeBookings()
        var b = active.filter(function (x) { return x.id === data.id })[0]
        if (!b) throw new Error('这个预约已经取消了，请刷新')
        if (active.some(function (x) { return x.id !== b.id && x.phone === b.phone && weekOf(x.date) === weekOf(date) })) throw new Error(b.name + ' 那一周已经有别的预约了')
        var state = slotState(s, active, date, time, b.id)
        if (state === 'blocked') throw new Error('这个时段被锁住了，先解锁再改')
        if (state !== 'free') throw new Error('这个时段已经有人了')
        store.updateBooking(b.id, { date: date, time: time, minutes: s.slotMinutes })
        return { old: b, now: Object.assign({}, b, { date: date, time: time, minutes: s.slotMinutes }) }
      })
      store.sendMail('[' + cfg.shop.name + '] 预约改时间：' + moved.old.name + ' ' + moved.old.date + ' ' + moved.old.time + ' → ' + date + ' ' + time,
        '原来：' + moved.old.date + ' ' + moved.old.time + '\n现在：\n' + bookingText(moved.now))
      return { booking: adminBooking(moved.now), emailed: mailCustomer(moved.now, 'moved', moved.old) }
    },

    setTip: function (data) {
      requireAdmin(data)
      var tip = Math.round(Number(data.tip) * 100) / 100
      if (!(tip >= 0 && tip <= 1000)) throw new Error('小费金额无效')
      var b = findActive(data.id)
      if (!b) throw new Error('找不到这个预约，可能已取消，请刷新')
      store.updateBooking(b.id, { tip: tip })
      return { id: b.id, tip: tip }
    },

    // 营业时间：每周营业哪几天、几点开始、几点结束、每位多长时间
    setSettings: function (data) {
      requireAdmin(data)
      var cur = getSettings()
      var next = JSON.parse(JSON.stringify(cur))
      if (data.openWeekdays !== undefined) {
        next.openWeekdays = cleanWeekdays(data.openWeekdays)
        if (!next.openWeekdays) throw new Error('至少要选一天营业')
      }
      if (data.slotMinutes !== undefined) {
        next.slotMinutes = Number(data.slotMinutes)
        if (cfg.slotOptions.indexOf(next.slotMinutes) < 0) throw new Error('时长无效')
      }
      if (data.startTime !== undefined) next.startTime = data.startTime
      if (data.endTime !== undefined) next.endTime = data.endTime
      if (!validHours(next.startTime, next.endTime, next.slotMinutes)) {
        var b = timeBounds(cur)
        if (data.startTime !== undefined) throw new Error('开始时间要在 ' + b.earliestStart + ' 到 ' + b.latestStart + ' 之间')
        if (data.endTime !== undefined) throw new Error('结束时间要在 ' + b.earliestEnd + ' 到 ' + b.latestEnd + ' 之间')
        throw new Error('开始到结束之间排不下一位 ' + next.slotMinutes + ' 分钟的客人，先把结束时间往后调')
      }
      store.saveSettings(next)
      return settingsReply(next)
    },

    // 临时休息某一天 / 恢复营业（已经约好的客人不会自动取消）
    setDayClosed: function (data) {
      requireAdmin(data)
      var s = getSettings()
      if (openDates(s, true).indexOf(data.date) < 0) throw new Error('这一天本来就不营业')
      s.closedDates = s.closedDates.filter(function (d) { return d !== data.date })
      if (data.closed) s.closedDates.push(data.date)
      store.saveSettings(s)
      return settingsReply(s)
    },

    // 锁住 / 解锁某一天的某个时段（锁住后顾客约不了这个时间）
    toggleBlock: function (data) {
      requireAdmin(data)
      var s = getSettings()
      if (openDates(s, true).indexOf(data.date) < 0) throw new Error('这一天不营业')
      var exists = s.blocked.some(function (b) { return b.date === data.date && b.time === data.time })
      if (exists) {
        s.blocked = s.blocked.filter(function (b) { return !(b.date === data.date && b.time === data.time) })
      } else {
        if (allSlots(s).indexOf(data.time) < 0) throw new Error('时间段无效')
        if (clash(activeBookings(), data.date, data.time, s.slotMinutes)) throw new Error('这个时段已经有预约了，不能锁')
        s.blocked.push({ date: data.date, time: data.time, minutes: s.slotMinutes })
      }
      store.saveSettings(s)
      var out = settingsReply(s)
      out.locked = !exists
      return out
    }
  }

  return {
    config: cfg,
    label: label,
    handle: function (action, data) {
      var fn = actions[action]
      if (!fn) throw new Error('未知操作')
      return fn(data || {})
    }
  }
}
