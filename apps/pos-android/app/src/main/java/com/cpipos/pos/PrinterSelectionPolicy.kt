package com.cpipos.pos

/**
 * Pure selection policy shared by Android printer discovery/resolution.
 *
 * The policy deliberately separates "can technically write bytes" from
 * "safe to auto-select as a printer". Many POS terminals expose LAN, UART,
 * cameras, audio devices and other writable transports; those devices must
 * never become printers only because Android can write to them.
 */
internal object PrinterSelectionPolicy {
    fun usbMayAutoSelect(
        hasPrinterClassInterface: Boolean,
        manufacturerName: String?,
        productName: String?
    ): Boolean = hasPrinterClassInterface ||
        PrinterCapabilityHints.looksLikePrinterName(manufacturerName) ||
        PrinterCapabilityHints.looksLikePrinterName(productName)

    fun usbMayUseGenericWritableEndpoint(hasExplicitPhysicalSelector: Boolean): Boolean =
        hasExplicitPhysicalSelector

    fun bluetoothMayAutoSelect(name: String?): Boolean =
        PrinterCapabilityHints.looksLikePrinterName(name)

    /**
     * Some embedded printers accept the standard RFCOMM SPP UUID without advertising it.
     * Exact-MAC verification may use that fallback only when the device is bonded and has
     * independent printer evidence. SPP advertisement by itself is not printer identity.
     */
    fun bluetoothExactBondedMayVerify(
        bonded: Boolean,
        printerEvidence: Boolean,
        sppAdvertised: Boolean
    ): Boolean = bonded && (sppAdvertised || printerEvidence)
}
