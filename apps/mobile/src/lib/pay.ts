import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";

/**
 * Open a payment: a upi:// intent hands off to the shopper's UPI app (GPay, PhonePe, Paytm…); an https
 * link (the test gateway's page) opens in an in-app browser.
 */
export async function openPayment(intent: string) {
  if (/^https?:\/\//.test(intent)) return void (await WebBrowser.openBrowserAsync(intent));
  if (await Linking.canOpenURL(intent)) return void (await Linking.openURL(intent));
  throw new Error("No UPI app found on this phone. Install one, or pay from the GhostCart website.");
}
