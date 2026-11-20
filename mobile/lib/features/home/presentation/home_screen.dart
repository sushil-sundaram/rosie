import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Rosie', style: Theme.of(context).textTheme.titleLarge?.copyWith(color: AppTheme.textPrimary)),
            Text('Hub', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.textMuted)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () {},
          ),
          const Padding(
            padding: EdgeInsets.only(right: 16.0),
            child: CircleAvatar(
              radius: 16,
              backgroundColor: AppTheme.surfaceContainerHigh,
              child: Text('ST', style: TextStyle(fontSize: 12, color: AppTheme.textPrimary)),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
          _buildWelcomeHeader(),
          const SizedBox(height: 16),
          _buildCompanionTile(),
          const SizedBox(height: 16),
          _buildQuickActions(),
          const SizedBox(height: 24),
          _buildMonthlySpendCard(),
          const SizedBox(height: 24),
          _buildDinnerCard(),
          const SizedBox(height: 24),
          _buildChoresDueCard(),
          const SizedBox(height: 24),
          _buildDailyTipCard(),
          const SizedBox(height: 80),
        ],
      ),
    );
  }

  Widget _buildWelcomeHeader() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Text('Good morning, Alex', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                SizedBox(width: 8),
                Text('✦', style: TextStyle(color: AppTheme.primary, fontSize: 18)),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Container(width: 8, height: 8, decoration: const BoxDecoration(color: Color(0xFF82A893), shape: BoxShape.circle)),
                const SizedBox(width: 8),
                const Text('ROSIE HEARTH WHISPER', style: TextStyle(color: AppTheme.textMuted, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
              ],
            ),
          ],
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: const Color(0xFF58292B).withValues(alpha: 0.4),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF8B3A4A).withValues(alpha: 0.4)),
          ),
          child: const Row(
            children: [
              Icon(Icons.eco, color: AppTheme.secondaryContainer, size: 16),
              SizedBox(width: 4),
              Text('Calm', style: TextStyle(color: AppTheme.secondaryContainer, fontSize: 12)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildCompanionTile() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppTheme.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppTheme.borderLight),
            ),
            child: const Icon(Icons.smart_toy, color: AppTheme.primary),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('ROSIE HEARTH WHISPER', style: TextStyle(color: AppTheme.primary, fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
                Text('Dishwasher finished • compost bin due at 6 PM', style: TextStyle(color: AppTheme.textMuted, fontSize: 12), overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: AppTheme.surfaceContainerHigh,
              shape: BoxShape.circle,
              border: Border.all(color: AppTheme.borderLight),
            ),
            child: const Icon(Icons.chevron_right, color: AppTheme.textMuted, size: 18),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickActions() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _buildActionBtn(title: '+ Log Expense', icon: Icons.receipt_long, isPrimary: true),
          const SizedBox(width: 8),
          _buildActionBtn(title: 'Plan Meals', icon: Icons.restaurant_menu, iconColor: AppTheme.primary),
          const SizedBox(width: 8),
          _buildActionBtn(title: '+ Add Chore', icon: Icons.check_circle, iconColor: AppTheme.secondary),
        ],
      ),
    );
  }

  Widget _buildActionBtn({required String title, required IconData icon, bool isPrimary = false, Color? iconColor}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: isPrimary ? AppTheme.primary : AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(8),
        border: isPrimary ? null : Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: isPrimary ? AppTheme.onPrimary : (iconColor ?? AppTheme.textPrimary)),
          const SizedBox(width: 6),
          Text(title, style: TextStyle(color: isPrimary ? AppTheme.onPrimary : AppTheme.textPrimary, fontWeight: FontWeight.bold, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _buildMonthlySpendCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Icon(Icons.pie_chart, color: AppTheme.primary, size: 18),
                  ),
                  const SizedBox(width: 8),
                  const Text('Household Monthly Spend', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.borderLight),
                ),
                child: const Text('October', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
              )
            ],
          ),
          const SizedBox(height: 16),
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text('\$1,840', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
                  SizedBox(width: 6),
                  Text('spent', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                ],
              ),
              Text.rich(TextSpan(
                text: 'Budget: ',
                style: TextStyle(color: AppTheme.textMuted, fontSize: 12),
                children: [
                  TextSpan(text: '\$2,400', style: TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.bold)),
                ]
              ))
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Row(
              children: [
                Expanded(flex: 48, child: Container(height: 12, color: AppTheme.primary)),
                Expanded(flex: 28, child: Container(height: 12, color: AppTheme.secondary)),
                Expanded(flex: 14, child: Container(height: 12, color: const Color(0xFF8B3A4A))),
                Expanded(flex: 10, child: Container(height: 12, color: AppTheme.textMuted)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            childAspectRatio: 3,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            children: [
              _buildCategoryPill('Groceries', '\$883', '48%', AppTheme.primary),
              _buildCategoryPill('Utilities', '\$515', '28%', AppTheme.secondary),
              _buildCategoryPill('Maintenance', '\$257', '14%', const Color(0xFF8B3A4A)),
              _buildCategoryPill('Sundries', '\$185', '10%', AppTheme.textMuted),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              color: AppTheme.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppTheme.borderLight),
            ),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('View Cost Breakdown', style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold, fontSize: 12)),
                SizedBox(width: 6),
                Icon(Icons.arrow_forward, color: AppTheme.primary, size: 16),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCategoryPill(String name, String amount, String percent, Color color) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        children: [
          Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(name, style: const TextStyle(color: AppTheme.textMuted, fontSize: 10), overflow: TextOverflow.ellipsis),
                Row(
                  children: [
                    Text(amount, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                    const SizedBox(width: 4),
                    Text('($percent)', style: const TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                  ],
                ),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildDinnerCard() {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: AppTheme.primary.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Icon(Icons.soup_kitchen_rounded, color: AppTheme.primary, size: 18),
                    ),
                    const SizedBox(width: 8),
                    const Text("Today's Dinner", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFF58292B).withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF8B3A4A).withValues(alpha: 0.4)),
                  ),
                  child: const Text('Tonight • 7:30 PM', style: TextStyle(color: AppTheme.secondaryContainer, fontSize: 10)),
                )
              ],
            ),
          ),
          Stack(
            children: [
              Container(
                height: 180,
                width: double.infinity,
                decoration: const BoxDecoration(
                  image: DecorationImage(
                    image: NetworkImage('https://lh3.googleusercontent.com/aida-public/AB6AXuApLPvU9lGl-T2YiHRfRZPi6TyB_mscb-zBTPEPpEZl6qVbJeQYv7QE-ihG-J49mgI-WeKVOaYXtX-9q75mKJa41i3iP0wTeZYR2UDWgKSpfa1i7dfg5CCpDWpaUwvxXWjd6RaTleF7iP5FWufDoHRsxKy7pE41UI9m_reLbdU89v75LU0YK5M5lbLC7UUjBH1l2i716kLnvI_hSKluqrHypLxpwOcHB-52IRuDrtz8nWi_4qn_LJybqQ'),
                    fit: BoxFit.cover,
                  ),
                ),
              ),
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.bottomCenter,
                      end: Alignment.topCenter,
                      colors: [
                        AppTheme.surfaceContainer.withValues(alpha: 1.0),
                        AppTheme.surfaceContainer.withValues(alpha: 0.5),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                bottom: 12,
                left: 12,
                right: 12,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Quinoa & Roasted Veggies', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, height: 1.2)),
                        Text('Nourishing Hearth Bowl', style: TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.w500)),
                      ],
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppTheme.surfaceContainerHigh.withValues(alpha: 0.9),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: AppTheme.borderLight),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.schedule, color: AppTheme.primary, size: 14),
                          SizedBox(width: 4),
                          Text('25m', style: TextStyle(fontSize: 10)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 24,
                          height: 24,
                          decoration: const BoxDecoration(
                            color: AppTheme.primary,
                            shape: BoxShape.circle,
                          ),
                          child: const Center(child: Text('M', style: TextStyle(color: AppTheme.onPrimary, fontWeight: FontWeight.bold, fontSize: 12))),
                        ),
                        const SizedBox(width: 8),
                        const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Cook assigned', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                            Text('Maya & Rosie', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          ],
                        ),
                      ],
                    ),
                    const Row(
                      children: [
                        Icon(Icons.check_box, color: AppTheme.secondary, size: 16),
                        SizedBox(width: 4),
                        Text('Ingredients ready', style: TextStyle(color: AppTheme.secondary, fontSize: 10)),
                      ],
                    )
                  ],
                ),
                const SizedBox(height: 16),
                const Divider(height: 1),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(
                          color: AppTheme.primary,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.menu_book, color: AppTheme.onPrimary, size: 18),
                            SizedBox(width: 6),
                            Text('View Recipe', style: TextStyle(color: AppTheme.onPrimary, fontWeight: FontWeight.bold, fontSize: 12)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: AppTheme.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppTheme.borderLight),
                      ),
                      child: const Icon(Icons.swap_horiz, color: AppTheme.textMuted, size: 20),
                    )
                  ],
                )
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildChoresDueCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: AppTheme.secondary.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Icon(Icons.checklist, color: AppTheme.secondary, size: 18),
                  ),
                  const SizedBox(width: 8),
                  const Text('Chores Due Today', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.secondary.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.secondary.withValues(alpha: 0.2)),
                ),
                child: const Text('1 of 3 done', style: TextStyle(color: AppTheme.secondary, fontSize: 10, fontWeight: FontWeight.bold)),
              )
            ],
          ),
          const SizedBox(height: 16),
          _buildChoreItem('Wipe down kitchen counters', 'Post-Dinner', 'A', false),
          const SizedBox(height: 6),
          _buildChoreItem('Compost & recycling bins out', 'By 6 PM', 'J', false, isError: true),
          const SizedBox(height: 6),
          _buildChoreItem('Empty dishwasher morning cycle', 'Completed', 'M', true),
          const SizedBox(height: 8),
          const Row(
            children: [
              Icon(Icons.add, color: AppTheme.primary, size: 18),
              SizedBox(width: 8),
              Text('Add chore for today', style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold, fontSize: 12)),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildChoreItem(String title, String timeStr, String avatarLtr, bool isDone, {bool isError = false}) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: isDone ? AppTheme.background.withValues(alpha: 0.6) : AppTheme.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: isDone ? AppTheme.borderLight.withValues(alpha: 0.5) : AppTheme.borderLight),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Row(
              children: [
                const Icon(Icons.drag_indicator, color: AppTheme.textMuted, size: 18),
                const SizedBox(width: 8),
                Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    color: isDone ? AppTheme.primary : AppTheme.background,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: isDone ? AppTheme.primary : AppTheme.borderLight, width: 1.5),
                  ),
                  child: isDone ? const Center(child: Icon(Icons.check, color: AppTheme.onPrimary, size: 14)) : null,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title, 
                    style: TextStyle(
                      color: isDone ? AppTheme.textMuted : AppTheme.textPrimary,
                      decoration: isDone ? TextDecoration.lineThrough : null,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: isDone ? AppTheme.secondary.withValues(alpha: 0.15) : (isError ? const Color(0xFF58292B).withValues(alpha: 0.5) : AppTheme.surfaceContainerHigh),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: isDone ? AppTheme.secondary.withValues(alpha: 0.2) : (isError ? const Color(0xFF8B3A4A).withValues(alpha: 0.4) : AppTheme.borderLight)),
                ),
                child: Text(timeStr, style: TextStyle(color: isDone ? AppTheme.secondary : (isError ? Colors.red[300] : AppTheme.textMuted), fontSize: 10)),
              ),
              const SizedBox(width: 6),
              Container(
                width: 20,
                height: 20,
                decoration: BoxDecoration(
                  color: isError ? const Color(0xFF3D1C24) : AppTheme.primary,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(avatarLtr, style: TextStyle(color: isError ? const Color(0xFFFFBDBA) : AppTheme.onPrimary, fontWeight: FontWeight.bold, fontSize: 10))
                ),
              )
            ],
          )
        ],
      ),
    );
  }

  Widget _buildDailyTipCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.local_fire_department, color: AppTheme.primary, size: 20),
              SizedBox(width: 8),
              Text('ROSIE HEARTH WHISPER', style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold, fontSize: 10, letterSpacing: 1)),
            ],
          ),
          SizedBox(height: 8),
          Text(
            '“Batch-roasting autumn root vegetables on Wednesday saves up to 40 minutes across Thursday and Friday evening prep. Keep roasted veggies sealed with olive oil and sprigs of rosemary.”',
            style: TextStyle(height: 1.5),
          ),
          SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Shared by Maya • 2 days ago', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
              Row(
                children: [
                  Icon(Icons.favorite, color: AppTheme.textMuted, size: 16),
                  SizedBox(width: 4),
                  Text('Applaud', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                ],
              )
            ],
          )
        ],
      ),
    );
  }
}
