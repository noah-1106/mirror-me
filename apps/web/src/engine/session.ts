/** 用户档案（名字 + 知情同意）。树/记忆/声线按名字隔离。 */
export function getProfile(): string {
  return localStorage.getItem('mirror-me-profile') ?? '';
}

export function setProfile(profile: string): void {
  localStorage.setItem('mirror-me-profile', profile);
}

function getSessionId(): string {
  const KEY = `mirror-me-session-${getProfile()}`;
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * 离开即清除（隐私设计）：页面关闭/刷新时，信标清除服务端会话与声纹素材，
 * 并清掉本地键——下次进入是干净的全新会话。
 */
export function purgeOnLeave(): void {
  const profile = getProfile();
  if (!profile) return;
  const sessionId = getSessionId();
  const url = `/api/session/purge?session=${encodeURIComponent(sessionId)}&voice=${encodeURIComponent(profile)}`;
  navigator.sendBeacon(url, new Blob([], { type: 'text/plain' }));
  localStorage.removeItem(`mirror-me-session-${profile}`);
  localStorage.removeItem('mirror-me-profile');
}
