// 顾客页的中英文切换。第一次按手机系统语言选择，之后记住顾客自己的选择。
// 店主后台只用中文（页面里先设置 window.SAM_FORCE_LANG = 'zh'）
var I18N = {
  zh: {
    contactTitle: '地址与联系方式', contactOwner: '联系店主', wechat: '微信号', phoneLabel: '电话', copy: '复制', call: '拨打',
    name: '客户名称', namePh: '填写你的名字', phone: '手机号', phoneNote: '用来确认和取消预约', phonePh: '例如 912-555-0123',
    payment: '付款方式', cash: '现金', zelleNote: '理完发后转账到这个 Zelle 账号', date: '日期', time: '时间',
    findMine: '用手机号查找我的预约', owner: '店主入口', book: '预约',
    confirmTitle: '确认预约', addr: '地址', submit: '确认预约', later: '再想想', success: '预约成功', hello: '到时见，{name}', done: '完成',
    every: '每{days}', slotNote: '剩 {n} 个空位 · 每位 {m} 分钟',
    bookedWeek: '这周已经约好了', onePerWeek: '每人每周可预约一次', full: '这天已约满', nextWeek: '看看下一周吧',
    closedTitle: '近期休息', closedSub: '暂时没有可以预约的日子，请稍后再来看看',
    booked: '已预约', fullShort: '已约满', paidBy: '{pay}付款', copyAddr: '复制地址', cancelBooking: '取消预约',
    cancelQ: '取消这个预约？', cancelBody: '取消后这个时间会开放给其他人。', keep: '保留', cancelled: '已取消',
    addrCopied: '地址已复制', wechatCopied: '微信号已复制', zelleCopied: 'Zelle 账号已复制', copied: '已复制',
    needName: '请先填写客户名称', needPhone: '请填写正确的手机号',
    findTitle: '查找我的预约', findBody: '输入预约时留的手机号', find: '查找', found: '找到 {n} 个预约', notFound: '没有找到这个手机号的预约',
    cancel: '取消', ok: '确定', copyFail: '复制失败', copyManual: '请手动记下：{text}',
    demo: '演示模式 · 数据只保存在这台设备上', langBtn: 'EN', pageTitle: 'Sam Barbershop · 在线预约',
    afternoon: '下午', evening: '晚上', morning: '上午'
  },
  en: {
    contactTitle: 'Address & contact', contactOwner: 'Contact the barber', wechat: 'WeChat', phoneLabel: 'Phone', copy: 'Copy', call: 'Call',
    name: 'Your name', namePh: 'Enter your name', phone: 'Phone number', phoneNote: 'Used to confirm or cancel', phonePh: 'e.g. 912-555-0123',
    payment: 'Payment', cash: 'Cash', zelleNote: 'Send by Zelle after your haircut', date: 'Date', time: 'Time',
    findMine: 'Find my booking by phone number', owner: 'Owner login', book: 'Book',
    confirmTitle: 'Confirm booking', addr: 'Address', submit: 'Confirm', later: 'Not now', success: 'You’re booked!', hello: 'See you soon, {name}', done: 'Done',
    every: '{days}', slotNote: '{n} spots left · {m} min each',
    bookedWeek: 'You’re booked this week', onePerWeek: 'One booking per person per week', full: 'Fully booked', nextWeek: 'Try next week',
    closedTitle: 'Closed for now', closedSub: 'No open days right now — please check back soon',
    booked: 'Booked', fullShort: 'Full', paidBy: 'Pay by {pay}', copyAddr: 'Copy address', cancelBooking: 'Cancel',
    cancelQ: 'Cancel this booking?', cancelBody: 'This time will open up for others.', keep: 'Keep', cancelled: 'Cancelled',
    addrCopied: 'Address copied', wechatCopied: 'WeChat ID copied', zelleCopied: 'Zelle copied', copied: 'Copied',
    needName: 'Please enter your name', needPhone: 'Please enter a valid phone number',
    findTitle: 'Find my booking', findBody: 'Enter the phone number you booked with', find: 'Find', found: 'Found {n} booking(s)', notFound: 'No bookings for this number',
    cancel: 'Cancel', ok: 'OK', copyFail: 'Couldn’t copy', copyManual: 'Please write it down: {text}',
    demo: 'Demo mode · data stays on this device', langBtn: '中文', pageTitle: 'Sam Barbershop · Book a haircut',
    afternoon: 'Afternoon', evening: 'Evening', morning: 'Morning'
  }
}

// 后台返回的中文提示 → 英文
var I18N_ERRORS = {
  '请填写客户名称': 'Please enter your name',
  '请填写正确的手机号': 'Please enter a valid phone number',
  '请选择付款方式': 'Please choose a payment method',
  '这一天不能预约': 'This day isn’t open for booking',
  '时间段无效': 'That time isn’t available',
  '这个时间已经过了': 'That time has already passed',
  '这个手机号这周已经预约过了': 'This phone number already has a booking this week',
  '这个时间不开放预约，请换一个': 'That time isn’t open — please pick another',
  '这个时间刚被别人约走了，请换一个': 'Someone just booked that time — please pick another',
  '这个预约已经取消了，请刷新页面': 'This booking was already cancelled — please refresh',
  '手机号和预约时留的不一致': 'That phone number doesn’t match the booking',
  '预约时间已经到了，不能再取消，请直接联系店主': 'It’s past the booking time — please contact the barber directly',
  '网络不太好，请稍后再试': 'Connection problem — please try again'
}

var LANG = (function () {
  if (window.SAM_FORCE_LANG) return window.SAM_FORCE_LANG
  var saved = ''
  try { saved = localStorage.getItem('sam-lang') || '' } catch (e) {}
  if (saved === 'zh' || saved === 'en') return saved
  return /^zh/i.test(navigator.language || '') ? 'zh' : 'en'
})()

function t(key, vars) {
  var s = (I18N[LANG] && I18N[LANG][key]) || I18N.zh[key] || key
  if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]) })
  return s
}

function trError(msg) { return LANG === 'en' && I18N_ERRORS[msg] ? I18N_ERRORS[msg] : msg }

function setLang(lang) {
  try { localStorage.setItem('sam-lang', lang) } catch (e) {}
  location.reload()
}

// 页面上带 data-i18n / data-i18n-ph 的元素换成当前语言
function applyI18n(root) {
  document.documentElement.lang = LANG === 'en' ? 'en' : 'zh'
  ;(root || document).querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')) })
  ;(root || document).querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')) })
}

// ---------- 日期、星期、时间的显示 ----------
var WEEKDAY_EN = { '周日': 'Sun', '周一': 'Mon', '周二': 'Tue', '周三': 'Wed', '周四': 'Thu', '周五': 'Fri', '周六': 'Sat' }
var WEEKDAY_EN_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
var MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtWeekday(w) { return LANG === 'en' ? (WEEKDAY_EN[w] || w) : w }
function fmtDate(date) {
  var p = date.split('-').map(Number)
  return LANG === 'en' ? MONTH_EN[p[1] - 1] + ' ' + p[2] : p[1] + '月' + p[2] + '日'
}
// 时间：中文 24 小时制（17:00），英文 12 小时制（5:00 PM）
function fmtTime(hhmm) {
  if (LANG !== 'en') return hhmm
  var p = hhmm.split(':').map(Number)
  var h = p[0] % 12 || 12
  return h + ':' + (p[1] < 10 ? '0' : '') + p[1] + ' ' + (p[0] < 12 ? 'AM' : 'PM')
}
