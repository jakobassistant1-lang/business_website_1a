// Course-name display helpers, shared across the dashboard, plan, course, and
// study surfaces so the same class always renders the same way (one place to fix
// if Canvas changes its course-code format).

/** Strip a Canvas course-code prefix like "2025F-10: " → just the readable name. */
export const cleanCourse = (name: string): string => name.replace(/^\d{4}[A-Za-z]{1,4}-\d+:\s*/, "").trim() || name;

/** First segment of a " · "-joined course label (the course name without extras). */
export const shortCourse = (name: string): string => name.split(" · ")[0];
