import React from 'react';

interface IconProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

const Icon: React.FC<IconProps & { d: string }> = ({ size = 20, color = 'currentColor', style, d }) => (
  <svg
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
  >
    <path d={d} fill={color} />
  </svg>
);

// 🚪 Rooms / Door
export const IconDoor: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M5 3H3v4h2V5h14v14H5v-2H3v4h18V3H5zm12 8h-2V9h-2V7h-2v2h2v2H3v2h10v2h-2v2h2v-2h2v-2h2v-2z" />
);

// 💬 Chat
export const IconChat: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M20 2H2v20h2V4h16v12H6v2H4v2h2v-2h16V2h-2z" />
);

// 🔌 Connect / Link
export const IconLink: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M4 6h7v2H4v8h7v2H2V6h2zm16 0h-7v2h7v8h-7v2h9V6h-2zm-3 5H7v2h10v-2z" />
);

// 📊 Chart / Stats
export const IconChart: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M13 5h2v14h-2V5zm-2 4H9v10h2V9zm-4 4H5v6h2v-6zm12 0h-2v6h2v-6z" />
);

// 🤖 User / Agent
export const IconUser: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M15 2H9v2H7v6h2V4h6V2zm0 8H9v2h6v-2zm0-6h2v6h-2V4zM4 16h2v-2h12v2H6v4h12v-4h2v6H4v-6z" />
);

// 👀 Eye / Spectator
export const IconEye: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M8 6h8v2H8V6zm-4 4V8h4v2H4zm-2 2v-2h2v2H2zm0 2v-2H0v2h2zm2 2H2v-2h2v2zm4 2H4v-2h4v2zm8 0v2H8v-2h8zm4-2v2h-4v-2h4zm2-2v2h-2v-2h2zm0-2h2v2h-2v-2zm-2-2h2v2h-2v-2zm0 0V8h-4v2h4zm-10 1h4v4h-4v-4z" />
);

// ✕ Close
export const IconClose: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M5 5h2v2H5V5zm4 4H7V7h2v2zm2 2H9V9h2v2zm2 0h-2v2H9v2H7v2H5v2h2v-2h2v-2h2v-2h2v2h2v2h2v2h2v-2h-2v-2h-2v-2h-2v-2zm2-2v2h-2V9h2zm2-2v2h-2V7h2zm0 0V5h2v2h-2z" />
);

// 🔥 Zap / Popular
export const IconZap: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M12 1h2v8h8v4h-2v-2h-8V5h-2V3h2V1zM8 7V5h2v2H8zM6 9V7h2v2H6zm-2 2V9h2v2H4zm10 8v2h-2v2h-2v-8H2v-4h2v2h8v6h2zm2-2v2h-2v-2h2zm2-2v2h-2v-2h2zm0 0h2v-2h-2v2z" />
);

// 🔍 Search
export const IconSearch: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M6 2h8v2H6V2zM4 6V4h2v2H4zm0 8H2V6h2v8zm2 2H4v-2h2v2zm8 0v2H6v-2h8zm2-2h-2v2h2v2h2v2h2v2h2v-2h-2v-2h-2v-2h-2v-2zm0-8h2v8h-2V6zm0 0V4h-2v2h2z" />
);

// 📅 Calendar
export const IconCalendar: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M15 2h2v2h4v18H3V4h4V2h2v2h6V2zM5 8h14V6H5v2zm0 2v10h14V10H5z" />
);

// 👥 Users / Group
export const IconUsers: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M11 0H5v2H3v6h2v2h6V8H5V2h6V0zm0 2h2v6h-2V2zM0 14h2v4h12v2H0v-6zm2 0h12v-2H2v2zm14 0h-2v6h2v-6zM15 0h4v2h-4V0zm4 8h-4v2h4V8zm0-6h2v6h-2V2zm5 12h-2v4h-4v2h6v-6zm-6-2h4v2h-4v-2z" />
);

// 🏠 Home
export const IconHome: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M14 2h-4v2H8v2H6v2H4v2H2v2h2v10h7v-6h2v6h7V12h2v-2h-2V8h-2V6h-2V4h-2V2zm0 2v2h2v2h2v2h2v2h-2v8h-3v-6H9v6H6v-8H4v-2h2V8h2V6h2V4h4z" />
);

// 🛑 Stop / Power
export const IconStop: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M6 6h12v12H6V6z" />
);

// 🏨 Hotel / Building
export const IconHotel: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M7 2h10v20H7V2zm2 2v2h2V4H9zm4 0v2h2V4h-2zM9 8v2h2V8H9zm4 0v2h2V8h-2zM9 12v2h2v-2H9zm4 0v2h2v-2h-2zm-2 4h2v6h-2v-6z" />
);

// ℹ️ Info
export const IconInfo: React.FC<IconProps> = (props) => (
  <Icon {...props} d="M3 3h2v18H3V3zm16 0H5v2h14v14H5v2h16V3h-2zm-8 6h2V7h-2v2zm2 8h-2v-6h2v6z" />
);
