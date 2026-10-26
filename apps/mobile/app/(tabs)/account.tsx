import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Body, Button, Card, Screen, s, Title } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Text } from "react-native";

export default function Account() {
  const { tokens, signOut, pushToken, pushNote } = useSession();
  return (
    <Screen>
      <Title>Account</Title>
      <Card>
        <Text style={[s.body, { fontWeight: "700" }]}>Shopping</Text>
        {tokens.buyer ? <Button kind="secondary" label="Sign out" onPress={() => signOut("buyer")} /> : <Button label="Sign in to shop" onPress={() => router.push({ pathname: "/sign-in", params: { as: "buyer" } })} />}
      </Card>
      <Card>
        <Text style={[s.body, { fontWeight: "700" }]}>Selling</Text>
        <Body muted>Approve offers from your phone.</Body>
        {tokens.member ? <Button kind="secondary" label="Sign out of your store" onPress={() => signOut("member")} /> : <Button kind="secondary" label="Sign in as a seller" onPress={() => router.push({ pathname: "/sign-in", params: { as: "member" } })} />}
      </Card>
      {(tokens.buyer || tokens.member) && <Body muted>{pushToken ? "Notifications are on for this phone." : (pushNote ?? "Setting up notifications…")}</Body>}
      <Card>
        <Text style={[s.body, { fontWeight: "700" }]}>Your data and help</Text>
        <Button kind="secondary" label="Your data and consent" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/account`)} />
        <Button kind="secondary" label="Make a complaint" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/grievance`)} />
        <Button kind="secondary" label="Terms and policies" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/legal`)} />
      </Card>
    </Screen>
  );
}
