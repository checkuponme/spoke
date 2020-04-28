import { r } from "../../models";
import { sendMessage } from "./twilio";
import { getFormattedPhoneNumber } from "../../../lib/phone-format";
import logger from "../../../logger";
import { config } from "../../../config";

export async function maybeOnboardNewContact(incomingMessage, trx = r.knex) {
  const contactCell = getFormattedPhoneNumber(incomingMessage.From);
  const campaignCell = getFormattedPhoneNumber(incomingMessage.To);
  const messagingServiceSid = incomingMessage.MessagingServiceSid;
  const {
    JOBS_SAME_PROCESS,
    ONBOARDING_ASSIGNMENT_ID: onboardingAssignmentId,
    ONBOARDING_CAMPAIGN_ID: onboardingCampaignId,
    ONBOARDING_USER_ID: onboardingUserId
  } = config;
  if (!onboardingCampaignId || !onboardingAssignmentId || !onboardingUserId) {
    logger.error(
      `ONBOARDING_ASSIGNMENT_ID, ONBOARDING_CAMPAIGN_ID, and ONBOARDING_USER_ID must be set in .env. Can not onboard ${contactCell}`
    );
    return;
  }

  const onboardingText =
    'Hi there! Thanks for sending a text to CheckUpOn.Me! If you would like to be texted by one of our volunteers, please reply to this message with the word "YES".';
  const users = await trx("campaign_contact")
    .select("id")
    .where({
      cell: contactCell
    })
    .limit(1);

  if (!users || !users.length) {
    const [
      [contactId],
      { organization_id: organizationId }
    ] = await Promise.all([
      await trx("campaign_contact")
        .insert({
          first_name: "",
          last_name: "",
          cell: contactCell,
          campaign_id: onboardingCampaignId
        })
        .returning("id"),
      await trx("messaging_service")
        .select("organization_id")
        .where({ messaging_service_sid: messagingServiceSid })
        .first()
    ]);
    const replyData = {
      user_id: onboardingUserId,
      user_number: campaignCell,
      assignment_id: onboardingAssignmentId,
      campaign_contact_id: contactId,
      send_status: JOBS_SAME_PROCESS ? "SENDING" : "QUEUED",
      queued_at: new Date(),
      text: onboardingText,
      contact_number: contactCell,
      service: "twilio",
      is_from_contact: false
    };
    const [replyMessage] = await trx("message")
      .insert(replyData)
      .returning(Object.keys(replyData).concat(["id"]));

    sendMessage(replyMessage, organizationId)
      .then(result => logger.info(`Onboarding sent to ${contactCell}`))
      .catch(err =>
        logger.error(`Unable to onboard new cell ${contactCell}: ${err}`)
      );
  }
}
