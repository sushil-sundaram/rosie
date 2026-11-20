import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rosie_mobile/main.dart';

void main() {
  testWidgets('RosieApp smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(
      const ProviderScope(
        child: RosieApp(),
      ),
    );

    // Verify that Rosie title is present.
    expect(find.text('Rosie'), findsWidgets);
  });
}
