/**
 * Utility functions for sending notifications via ntfy
 */

const NTFY_TOPIC = process.env.NTFY_TOPIC || "realtime_web_traffic";
const NTFY_URL = process.env.NTFY_URL || "https://ntfy.sh";

/**
 * Send a notification via ntfy
 */
export async function sendNtfyNotification(
  message: string,
  title: string = "Traffic Alert",
  priority: string = "4"
): Promise<void> {
  try {
    const response = await fetch(`${NTFY_URL}/${NTFY_TOPIC}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: priority,
      },
      body: message,
    });

    if (!response.ok) {
      throw new Error(`Failed to send ntfy notification: ${response.statusText}`);
    }

    console.log(`📢 Sent ntfy notification: ${title} - ${message}`);
  } catch (err: any) {
    console.error("Error sending ntfy notification:", err.message);
    // Don't throw - we don't want notification failures to break traffic tracking
  }
}

/**
 * Send traffic milestone alert
 */
export async function sendTrafficMilestoneAlert(
  milestone: number,
  currentTotal: number
): Promise<void> {
  const message = `Traffic alert reached!\n\nCurrent total: ${currentTotal.toLocaleString()}\nMilestone: ${milestone.toLocaleString()}`;
  
  await sendNtfyNotification(
    message,
    `Traffic Milestone: ${milestone.toLocaleString()}`,
    "4"
  );
}

