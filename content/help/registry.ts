export const HELP_LOCALES = ["en", "vi"] as const;
export type HelpLocale = (typeof HELP_LOCALES)[number];
export const HELP_LOCALE_COOKIE = "agent-hub-help-locale";

export const HELP_SECTIONS = ["start", "artifacts", "collaboration", "integration", "admin"] as const;
export type HelpSection = (typeof HELP_SECTIONS)[number];

export type HelpAudience = "user" | "admin" | "superadmin";

export type HelpTopic = {
  slug: string;
  section: HelpSection;
  title: Record<HelpLocale, string>;
  summary: Record<HelpLocale, string>;
  audience: HelpAudience[];
  related: string[];
  lastReviewed: string;
};

export const HELP_TOPICS = [
  {
    slug: "getting-started",
    section: "start",
    title: { en: "Getting started", vi: "Bắt đầu sử dụng" },
    summary: {
      en: "Learn the core concepts and complete your first Agent Hub workflow.",
      vi: "Tìm hiểu các khái niệm chính và hoàn thành luồng Agent Hub đầu tiên.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["finding-content", "prompts", "connect-agent"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "finding-content",
    section: "start",
    title: { en: "Find and reuse content", vi: "Tìm và tái sử dụng nội dung" },
    summary: {
      en: "Use search, filters, Explore, favorites, and duplication effectively.",
      vi: "Sử dụng tìm kiếm, bộ lọc, Explore, yêu thích và nhân bản hiệu quả.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["getting-started", "reuse-and-portability"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "prompts",
    section: "artifacts",
    title: { en: "Prompts", vi: "Prompt" },
    summary: {
      en: "Create reusable prompts with variables, ownership, and version history.",
      vi: "Tạo prompt tái sử dụng với biến, quyền sở hữu và lịch sử phiên bản.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["versions-and-history", "connect-agent"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "skills",
    section: "artifacts",
    title: { en: "Skills", vi: "Skill" },
    summary: {
      en: "Package reusable instructions and supporting files for agents.",
      vi: "Đóng gói chỉ dẫn tái sử dụng và file hỗ trợ cho agent.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["cli-sync", "connect-agent"],
    lastReviewed: "2026-07-28",
  },
  {
    slug: "docs",
    section: "artifacts",
    title: { en: "Docs", vi: "Doc" },
    summary: {
      en: "Maintain reference material and connect it to plans and projects.",
      vi: "Quản lý tài liệu tham chiếu và liên kết với plan, project.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["plans", "projects", "sharing-and-assignment"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "plans",
    section: "artifacts",
    title: { en: "Plans", vi: "Plan" },
    summary: {
      en: "Turn goals into trackable tasks for people and agents.",
      vi: "Chuyển mục tiêu thành task có thể theo dõi cho người dùng và agent.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["docs", "projects", "sharing-and-assignment"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "projects",
    section: "collaboration",
    title: { en: "Projects", vi: "Project" },
    summary: {
      en: "Organize docs, plans, members, and workflows around an initiative.",
      vi: "Tổ chức doc, plan, thành viên và workflow theo một sáng kiến.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["docs", "plans", "workflows"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "workflows",
    section: "collaboration",
    title: { en: "Workflows", vi: "Workflow" },
    summary: {
      en: "Move work through stages and attach the artifacts each stage needs.",
      vi: "Di chuyển công việc qua các stage và gắn artifact cần thiết.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["projects", "plans"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "versions-and-history",
    section: "collaboration",
    title: { en: "Versions and history", vi: "Phiên bản và lịch sử" },
    summary: {
      en: "Compare changes, inspect older content, and roll back safely.",
      vi: "So sánh thay đổi, xem nội dung cũ và rollback an toàn.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["prompts", "sharing-and-assignment"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "sharing-and-assignment",
    section: "collaboration",
    title: { en: "Sharing and assignment", vi: "Chia sẻ và phân công" },
    summary: {
      en: "Understand access, sharing, assigners, assignees, and notifications.",
      vi: "Hiểu quyền truy cập, chia sẻ, assigner, assignee và thông báo.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["spaces-and-permissions", "docs", "plans"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "reuse-and-portability",
    section: "collaboration",
    title: { en: "Reuse, import, and export", vi: "Tái sử dụng, import và export" },
    summary: {
      en: "Duplicate artifacts and move reusable bundles between hubs.",
      vi: "Nhân bản artifact và di chuyển bundle tái sử dụng giữa các hub.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["finding-content", "skills"],
    lastReviewed: "2026-07-28",
  },
  {
    slug: "connect-agent",
    section: "integration",
    title: { en: "Connect an AI agent", vi: "Kết nối AI agent" },
    summary: {
      en: "Create a scoped MCP token and connect a compatible AI client.",
      vi: "Tạo MCP token có scope và kết nối AI client tương thích.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["prompts", "skills", "cli-sync"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "cli-sync",
    section: "integration",
    title: { en: "CLI filesystem sync", vi: "Đồng bộ filesystem bằng CLI" },
    summary: {
      en: "Pull skills into a local agent workspace.",
      vi: "Tải skill vào workspace agent trên máy local.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["skills", "connect-agent"],
    lastReviewed: "2026-07-28",
  },
  {
    slug: "spaces-and-permissions",
    section: "admin",
    title: { en: "Spaces and permissions", vi: "Space và phân quyền" },
    summary: {
      en: "Model organizations, departments, teams, ownership, and inherited access.",
      vi: "Tổ chức organization, department, team, ownership và quyền kế thừa.",
    },
    audience: ["admin", "superadmin"],
    related: ["users-and-roles", "sharing-and-assignment"],
    lastReviewed: "2026-07-27",
  },
  {
    slug: "users-and-roles",
    section: "admin",
    title: { en: "Users and roles", vi: "User và role" },
    summary: {
      en: "View user profiles and understand memberships, responsibilities, activity, and roles.",
      vi: "Xem hồ sơ user và hiểu membership, trách nhiệm, activity và role.",
    },
    audience: ["user", "admin", "superadmin"],
    related: ["spaces-and-permissions", "audit-log"],
    lastReviewed: "2026-07-28",
  },
  {
    slug: "audit-log",
    section: "admin",
    title: { en: "Audit log", vi: "Audit log" },
    summary: {
      en: "Review important administrative and security events.",
      vi: "Kiểm tra các sự kiện quản trị và bảo mật quan trọng.",
    },
    audience: ["superadmin"],
    related: ["users-and-roles", "versions-and-history"],
    lastReviewed: "2026-07-27",
  },
] as const satisfies readonly HelpTopic[];

export type HelpTopicSlug = (typeof HELP_TOPICS)[number]["slug"];

export const HELP_SECTION_TITLES: Record<HelpSection, Record<HelpLocale, string>> = {
  start: { en: "Start here", vi: "Bắt đầu" },
  artifacts: { en: "Artifacts", vi: "Artifact" },
  collaboration: { en: "Collaboration", vi: "Cộng tác" },
  integration: { en: "Agent integration", vi: "Tích hợp agent" },
  admin: { en: "Administration", vi: "Quản trị" },
};

export function getHelpTopic(slug: string) {
  return HELP_TOPICS.find((topic) => topic.slug === slug);
}

export function isHelpLocale(value: string | undefined): value is HelpLocale {
  return HELP_LOCALES.includes(value as HelpLocale);
}
