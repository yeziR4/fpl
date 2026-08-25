/**
 * Triggers a local file download of the seed phrase -- the one real
 * backup, handed to the user the moment their wallet is created. This
 * never touches a server: it's a client-side Blob + an <a download>
 * click, same trick any "export my data" button uses.
 */
export function downloadSeedPhrase(address: string, mnemonic: string): void {
  const body = [
    "Vara wallet seed phrase",
    "",
    `Address: ${address}`,
    "",
    mnemonic,
    "",
    "This is the ONLY copy of your seed phrase. Anyone who has it can",
    "spend everything in this wallet. Store it somewhere safe and",
    "offline -- we cannot recover it for you if it's lost.",
    "",
    "To restore this wallet on a new browser or device, use \"Restore",
    "wallet\" and paste this phrase back in.",
    "",
  ].join("\n");

  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vara-wallet-${address.slice(0, 8)}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
