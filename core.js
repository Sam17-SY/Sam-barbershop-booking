// 网页版预约系统的核心规则。
// 同一份代码跑在两个地方：Google Apps Script（正式后台，数据存 Google 表格）和浏览器（演示模式，数据存本机）。
// 规则和小程序云函数一致：每周营业一天，45 分钟一位，同一个手机号每周只能约一次，同一时段不会被两个人约到。

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
  // 默认营业日：0=周日 … 6=周六；店主可在后台改
  openWeekday: 0,
  startTime: '14:00',
  endTime: '23:00',
  earliestStart: '08:00',
  latestEnd: '23:45',
  slotMinutes: 45,
  weeksAhead: 2,
  // 每次理发的价格（美元），预约时记在这条预约上；小费由店主在后台加
  price: 35
}

// store 需要提供：listBookings() addBooking(b) updateBooking(id, patch) getSettings() saveSettings(s)
//               now() → { date: 'YYYY-MM-DD', minutes }（店铺当地时间） lock(fn) sendMail(subject, text) checkPassword(pw)
function createSamBackend(cfg, store) {
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
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
  function isHHMM(t) { return typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) }

  // 开始和结束时间互相制约：中间至少要能排下一位客人
  function validHours(start, end) {
    if (!isHHMM(start) || !isHHMM(end)) return false
    return toMinutes(start) >= toMinutes(cfg.earliestStart) && toMinutes(end) <= toMinutes(cfg.latestEnd) &&
      toMinutes(start) + cfg.slotMinutes <= toMinutes(end)
  }

  function timeBounds(s) {
    return {
      earliestStart: cfg.earliestStart,
      latestStart: fromMinutes(toMinutes(s.endTime) - cfg.slotMinutes),
      earliestEnd: fromMinutes(toMinutes(s.startTime) + cfg.slotMinutes),
      latestEnd: cfg.latestEnd
    }
  }

  function getSettings() {
    var saved = store.getSettings() || {}
    var s = { openWeekday: cfg.openWeekday, startTime: cfg.startTime, endTime: cfg.endTime }
    if (typeof saved.openWeekday === 'number') s.openWeekday = saved.openWeekday
    var start = saved.startTime || s.startTime
    var end = saved.endTime || s.endTime
    if (validHours(start, end)) { s.startTime = start; s.endTime = end }
    return s
  }

  function allSlots(s) {
    var slots = []
    for (var t = toMinutes(s.startTime); t + cfg.slotMinutes <= toMinutes(s.endTime); t += cfg.slotMinutes) slots.push(fromMinutes(t))
    return slots
  }

  // 接下来几个营业日（每周一天）
  function openDates(weekday) {
    var today = store.now().date
    var dates = []
    for (var i = 0; dates.length < cfg.weeksAhead && i < 7 * cfg.weeksAhead + 7; i++) {
      var d = addDays(today, i)
      if (weekdayIndex(d) === weekday) dates.push(d)
    }
    return dates
  }

  function isPast(date, time) {
    var now = store.now()
    if (date !== now.date) return date < now.date
    return toMinutes(time) <= now.minutes
  }

  function overlaps(list, date, time) {
    var t = toMinutes(time)
    return list.some(function (b) { return b.date === date && Math.abs(toMinutes(b.time) - t) < cfg.slotMinutes })
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

  function money(n) { return '$' + (n % 1 ? n.toFixed(2) : n) }

  // 给顾客看的预约信息（不带手机号）
  function publicBooking(b) {
    return { id: b.id, date: b.date, time: b.time, name: b.name, payment: b.payment, price: Number(b.price) || 0, weekday: weekdayOf(b.date) }
  }

  function adminBooking(b) {
    var o = publicBooking(b)
    o.phone = b.phone
    o.tip = Number(b.tip) || 0
    return o
  }

  function bookingText(b) {
    return [
      '客户名称：' + b.name,
      '手机号：+' + b.phone,
      '时间：' + b.date + '（' + weekdayOf(b.date) + '）' + b.time,
      '付款方式：' + (PAYMENTS[b.payment] || '未选择') + '（' + money(Number(b.price) || 0) + '）',
      '地址：' + cfg.shop.address + ' ' + cfg.shop.doorNumber
    ].join('\n')
  }

  function requireAdmin(data) {
    if (!store.checkPassword(data && data.password)) throw new Error('密码不对')
  }

  var actions = {
    // 顾客页：营业日、时段、店铺信息；带上手机号时顺便返回“我的预约”
    getSlots: function (data) {
      var s = getSettings()
      var dates = openDates(s.openWeekday)
      var slots = allSlots(s)
      var active = activeBookings()
      var taken = active.filter(function (b) { return dates.indexOf(b.date) >= 0 })
      var phone = normPhone(data.phone)
      var today = store.now().date
      var mine = phone ? active.filter(function (b) { return b.phone === phone && b.date >= today }) : []
      return {
        shop: cfg.shop,
        slotMinutes: cfg.slotMinutes,
        price: cfg.price,
        startTime: s.startTime,
        endTime: s.endTime,
        dates: dates.map(function (date) {
          return {
            date: date,
            weekday: weekdayOf(date),
            bookedByMe: mine.some(function (b) { return b.date === date }),
            slots: slots.map(function (time) {
              return { time: time, available: !overlaps(taken, date, time) && !isPast(date, time) }
            })
          }
        }),
        myBookings: mine.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1 }).map(publicBooking)
      }
    },

    book: function (data) {
      var name = String(data.name || '').trim()
      if (!name || name.length > 30) throw new Error('请填写客户名称')
      var phone = normPhone(data.phone)
      if (phone.length < 11 || phone.length > 15) throw new Error('请填写正确的手机号')
      if (!PAYMENTS[data.payment]) throw new Error('请选择付款方式')
      var date = data.date, time = data.time
      var s = getSettings()
      if (openDates(s.openWeekday).indexOf(date) < 0) throw new Error('这一天不能预约')
      if (allSlots(s).indexOf(time) < 0) throw new Error('时间段无效')
      if (isPast(date, time)) throw new Error('这个时间已经过了')

      // 查重和写入放在锁里，两个人同时抢同一个时段，只有一个人能约上
      var booking = store.lock(function () {
        var active = activeBookings()
        // 每周只营业一天，所以“同一天只能约一次”就等于“每周一次”
        if (active.some(function (b) { return b.phone === phone && b.date === date })) throw new Error('这个手机号这周已经预约过了')
        if (overlaps(active, date, time)) throw new Error('这个时间刚被别人约走了，请换一个')
        var b = {
          id: date + '_' + time.replace(':', '') + '_' + Math.random().toString(36).slice(2, 7),
          date: date, time: time, name: name, phone: phone, payment: data.payment,
          price: cfg.price, tip: 0, status: 'booked', createdAt: new Date().toISOString(), cancelledAt: ''
        }
        store.addBooking(b)
        return b
      })
      store.sendMail('[' + cfg.shop.name + '] 新预约：' + name + ' ' + date + ' ' + time + '（' + PAYMENTS[data.payment] + '）', bookingText(booking))
      return { booking: publicBooking(booking), shop: cfg.shop }
    },

    // 顾客自己取消：要输入预约时留的手机号
    cancel: function (data) {
      var phone = normPhone(data.phone)
      var b = activeBookings().filter(function (x) { return x.id === data.id })[0]
      if (!b) throw new Error('这个预约已经取消了，请刷新页面')
      if (b.phone !== phone) throw new Error('手机号和预约时留的不一致')
      if (isPast(b.date, b.time)) throw new Error('预约时间已经到了，不能再取消，请直接联系店主')
      store.updateBooking(b.id, { status: 'cancelled', cancelledAt: new Date().toISOString() })
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
      var s = getSettings()
      var out = timeBounds(s)
      out.bookings = list.slice(0, past ? 300 : 1000).map(adminBooking)
      out.today = today
      out.slotMinutes = cfg.slotMinutes
      out.settings = s
      return out
    },

    adminCancel: function (data) {
      requireAdmin(data)
      var b = activeBookings().filter(function (x) { return x.id === data.id })[0]
      if (!b) throw new Error('这个预约已经取消了，请刷新')
      store.updateBooking(b.id, { status: 'cancelled', cancelledAt: new Date().toISOString() })
      store.sendMail('[' + cfg.shop.name + '] 预约已取消（店主操作）：' + b.name + ' ' + b.date + ' ' + b.time, bookingText(b))
      return { ok: true }
    },

    setTip: function (data) {
      requireAdmin(data)
      var tip = Math.round(Number(data.tip) * 100) / 100
      if (!(tip >= 0 && tip <= 1000)) throw new Error('小费金额无效')
      var b = activeBookings().filter(function (x) { return x.id === data.id })[0]
      if (!b) throw new Error('找不到这个预约，可能已取消，请刷新')
      store.updateBooking(b.id, { tip: tip })
      return { id: b.id, tip: tip }
    },

    setSettings: function (data) {
      requireAdmin(data)
      var cur = getSettings()
      var next = { openWeekday: cur.openWeekday, startTime: cur.startTime, endTime: cur.endTime }
      if (data.openWeekday !== undefined) {
        next.openWeekday = Number(data.openWeekday)
        if (!(next.openWeekday >= 0 && next.openWeekday <= 6)) throw new Error('营业日无效')
      }
      if (data.startTime !== undefined) next.startTime = data.startTime
      if (data.endTime !== undefined) next.endTime = data.endTime
      if (!validHours(next.startTime, next.endTime)) {
        var b = timeBounds(cur)
        if (data.startTime !== undefined) throw new Error('开始时间要在 ' + b.earliestStart + ' 到 ' + b.latestStart + ' 之间')
        throw new Error('结束时间要在 ' + b.earliestEnd + ' 到 ' + b.latestEnd + ' 之间')
      }
      store.saveSettings(next)
      var out = timeBounds(next)
      out.settings = next
      return out
    }
  }

  return {
    config: cfg,
    handle: function (action, data) {
      var fn = actions[action]
      if (!fn) throw new Error('未知操作')
      return fn(data || {})
    }
  }
}
