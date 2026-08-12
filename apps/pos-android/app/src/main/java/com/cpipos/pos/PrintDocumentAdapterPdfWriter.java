package com.cpipos.pos;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;

final class PrintDocumentAdapterPdfWriter {
    interface Events {
        void onWriteFinished(PageRange[] pages);
        void onWriteFailed(CharSequence error);
        void onWriteCancelled();
        void onLayoutFailed(CharSequence error);
        void onLayoutCancelled();
    }

    private PrintDocumentAdapterPdfWriter() {
    }

    static void write(
            PrintDocumentAdapter adapter,
            PrintAttributes attributes,
            CancellationSignal cancellation,
            ParcelFileDescriptor output,
            Events events
    ) {
        adapter.onLayout(
                null,
                attributes,
                cancellation,
                new PrintDocumentAdapter.LayoutResultCallback() {
                    @Override
                    public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                        adapter.onWrite(
                                new PageRange[]{PageRange.ALL_PAGES},
                                output,
                                cancellation,
                                new PrintDocumentAdapter.WriteResultCallback() {
                                    @Override
                                    public void onWriteFinished(PageRange[] pages) {
                                        events.onWriteFinished(pages);
                                    }

                                    @Override
                                    public void onWriteFailed(CharSequence error) {
                                        events.onWriteFailed(error);
                                    }

                                    @Override
                                    public void onWriteCancelled() {
                                        events.onWriteCancelled();
                                    }
                                }
                        );
                    }

                    @Override
                    public void onLayoutFailed(CharSequence error) {
                        events.onLayoutFailed(error);
                    }

                    @Override
                    public void onLayoutCancelled() {
                        events.onLayoutCancelled();
                    }
                },
                null
        );
    }
}
