/**
 * 杭客松小程序全局入口。
 *
 * 启动时做一件事：**校验本地 token 是否还有效**。
 *   · 有 token → 调 /api/auth/wechat-mini/session 确认身份
 *   · 失效（401 或 user:null）→ 静默重新 wx.login()，用户无感
 *
 * 为什么不在这里强制登录：活动看板是公开的（未登录也能看），
 * 强制登录会挡掉一半的浏览用户。真正需要身份的动作在各自页面里调 ensureLogin()。
 */

const { getToken, clearToken, fetchSession } = require("./utils/auth");

App({
  globalData: {
    /** { id, email, name, role } | null */
    user: null,
    /** token 是否已经确认过（不论有效与否），避免每个页面重复探测 */
    sessionChecked: false,
    /** 上次拿到的 canPublish，发起活动页用它决定要不要显示申请表单 */
    canPublish: false,
  },

  onLaunch() {
    this.restoreSession();
  },

  /**
   * 静默恢复会话。页面里也可以 await 它（比如"我的"页要立刻显示身份）。
   */
  async restoreSession() {
    if (this.globalData.sessionChecked) return this.globalData.user;

    const token = getToken();
    if (!token) {
      this.globalData.sessionChecked = true;
      this.globalData.user = null;
      return null;
    }

    const user = await fetchSession();
    if (!user) {
      // token 过期或服务端换了 AUTH_SECRET：清掉，后续动作会触发重新登录
      clearToken();
    }
    this.globalData.user = user;
    this.globalData.sessionChecked = true;
    return user;
  },

  /** 登录状态变化后调用，让下次 restoreSession 重新探测。 */
  invalidateSession() {
    this.globalData.sessionChecked = false;
  },
});
