export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export interface UserAgentDetails {
  device: string;
  os: string;
  browser: string;
  deviceType: DeviceType;
}

const cleanVersion = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value.replace(/_/g, '.').split('.').slice(0, 3).join('.');
};

const versioned = (name: string, version?: string): string => {
  const clean = cleanVersion(version);
  return clean ? `${name} ${clean}` : name;
};

const cleanDeviceName = (value?: string): string | undefined => {
  if (!value) return undefined;
  const clean = value
    .replace(/\s+Build\/.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (!clean || ['K', 'wv'].includes(clean)) return undefined;
  return clean;
};

const readBrowser = (userAgent: string): string => {
  const patterns: Array<[RegExp, string]> = [
    [/EdgiOS\/([\d.]+)/i, 'Edge'],
    [/EdgA?\/([\d.]+)/i, 'Edge'],
    [/OPiOS\/([\d.]+)/i, 'Opera'],
    [/OPR\/([\d.]+)/i, 'Opera'],
    [/YaBrowser\/([\d.]+)/i, 'Яндекс Браузер'],
    [/SamsungBrowser\/([\d.]+)/i, 'Samsung Internet'],
    [/CriOS\/([\d.]+)/i, 'Chrome'],
    [/Chrome\/([\d.]+)/i, 'Chrome'],
    [/FxiOS\/([\d.]+)/i, 'Firefox'],
    [/Firefox\/([\d.]+)/i, 'Firefox'],
    [/Instagram[ /]([\d.]+)/i, 'Instagram'],
    [/FBAV\/([\d.]+)/i, 'Facebook'],
  ];

  for (const [pattern, name] of patterns) {
    const match = userAgent.match(pattern);
    if (match) return versioned(name, match[1]);
  }

  if (/Safari\//i.test(userAgent)) {
    return versioned('Safari', userAgent.match(/Version\/([\d.]+)/i)?.[1]);
  }

  return 'Браузер неизвестен';
};

/**
 * Даёт короткое человекочитаемое описание вместо длинного сырого User-Agent.
 * User-Agent передаётся браузером и может быть неточным или подделанным.
 */
export const parseUserAgent = (userAgent: string): UserAgentDetails => {
  const isIphone = /iPhone/i.test(userAgent);
  const isIpad = /iPad/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && /Mobile\//i.test(userAgent));
  const isAndroid = /Android/i.test(userAgent);
  const isWindows = /Windows NT/i.test(userAgent);
  const isMac = /Macintosh|Mac OS X/i.test(userAgent) && !isIpad;
  const isLinux = /Linux/i.test(userAgent) && !isAndroid;

  let device = 'Неизвестное устройство';
  let os = 'ОС неизвестна';
  let deviceType: DeviceType = 'unknown';

  if (isIphone) {
    device = 'iPhone';
    const version = userAgent.match(/(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/i)?.[1];
    os = versioned('iOS', version);
    deviceType = 'mobile';
  } else if (isIpad) {
    device = 'iPad';
    const version = userAgent.match(/(?:CPU OS|OS) ([\d_]+)/i)?.[1]
      || userAgent.match(/Version\/([\d.]+)/i)?.[1];
    os = versioned('iPadOS', version);
    deviceType = 'tablet';
  } else if (isAndroid) {
    const version = userAgent.match(/Android\s+([\d.]+)/i)?.[1];
    const model = cleanDeviceName(
      userAgent.match(/Android[^;)]*;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+)/i)?.[1],
    );
    device = model || 'Android';
    os = versioned('Android', version);
    deviceType = /Mobile|Windows Phone/i.test(userAgent) ? 'mobile' : 'tablet';
  } else if (isWindows) {
    const ntVersion = userAgent.match(/Windows NT\s+([\d.]+)/i)?.[1];
    const windowsNames: Record<string, string> = {
      '10.0': 'Windows 10/11',
      '6.3': 'Windows 8.1',
      '6.2': 'Windows 8',
      '6.1': 'Windows 7',
    };
    device = 'PC';
    os = ntVersion ? windowsNames[ntVersion] || versioned('Windows NT', ntVersion) : 'Windows';
    deviceType = /Mobile|Windows Phone/i.test(userAgent) ? 'mobile' : 'desktop';
  } else if (isMac) {
    const version = userAgent.match(/Mac OS X\s+([\d_]+)/i)?.[1];
    device = 'Mac';
    os = versioned('macOS', version);
    deviceType = 'desktop';
  } else if (isLinux) {
    device = 'PC';
    os = 'Linux';
    deviceType = 'desktop';
  }

  return {
    device,
    os,
    browser: readBrowser(userAgent),
    deviceType,
  };
};

export const formatUserAgent = (userAgent: string): string => {
  const details = parseUserAgent(userAgent);
  return [details.device, details.os, details.browser, details.deviceType].join(' · ');
};
