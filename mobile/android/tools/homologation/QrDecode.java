import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import java.io.File;
import java.util.Map;
import javax.imageio.ImageIO;

/**
 * Test-only: prints the text of the QR in a screenshot (the desktop's Settings › Devices), so homologation on the AVD
 * can hand it to a debug build. Uses only zxing core, the app's own dependency. Run through pair-avd.sh.
 */
public class QrDecode {
    public static void main(String[] args) throws Exception {
        var image = ImageIO.read(new File(args[0]));
        int width = image.getWidth(), height = image.getHeight();
        int[] pixels = image.getRGB(0, 0, width, height, null, 0, width);
        var bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(width, height, pixels)));
        System.out.print(new MultiFormatReader().decode(bitmap, Map.of(DecodeHintType.TRY_HARDER, true)).getText());
    }
}
