import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

class ChoresScreen extends StatelessWidget {
  const ChoresScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Rosie', style: Theme.of(context).textTheme.titleLarge?.copyWith(color: AppTheme.textPrimary)),
            Text('Chores', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.textMuted)),
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
          _buildHearthHarmonyCard(),
          const SizedBox(height: 24),
          _buildFilterPills(),
          const SizedBox(height: 24),
          _buildKanbanTabs(),
          const SizedBox(height: 24),
          _buildChoreCards(),
          const SizedBox(height: 80), // Fab space
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {},
        backgroundColor: AppTheme.primary,
        foregroundColor: AppTheme.onPrimary,
        icon: const Icon(Icons.add, size: 20),
        label: const Text('New Chore'),
      ),
    );
  }

  Widget _buildHearthHarmonyCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.fireplace, color: AppTheme.primary, size: 24),
                  SizedBox(width: 8),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Hearth Harmony', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text('Household equitable chore split', style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                    ],
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppTheme.borderLight),
                ),
                child: const Row(
                  children: [
                    Text('88%', style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold, fontSize: 16)),
                    SizedBox(width: 4),
                    Text('in sync', style: TextStyle(color: AppTheme.textMuted, fontSize: 10)),
                  ],
                ),
              )
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(width: 6, height: 6, decoration: const BoxDecoration(color: AppTheme.primary, shape: BoxShape.circle)),
                  const SizedBox(width: 6),
                  const Text('12 of 18 tasks complete', style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                ],
              ),
              const Text('+24 hearth points', style: TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Row(
              children: [
                Expanded(flex: 68, child: Container(height: 8, color: AppTheme.primary)),
                Expanded(flex: 14, child: Container(height: 8, color: AppTheme.secondary)),
                Expanded(flex: 18, child: Container(height: 8, color: AppTheme.background)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  _buildAvatar('https://lh3.googleusercontent.com/aida-public/AB6AXuBw_WM8OrzeEBjHzEm2kQcC7SNNOyJfN4_qIYQ-KoycGnrfnVwxtKJiZpmz35M9HoZ6Eara655HU8GPTgzg6EsRFVVMInSADcAx17grzxzBeNedZ54UuS8qy_5pRQjMfinT5ktzmjWNIJ5NPv46FmRXQe_7kVZ0ZMttVYWdhBRyg_DAP8RJRF2dMOr73pySh6qjE2a1BbAA7-1OiLljkACOdArP8KA9rqa67UaD8cAJndEeB4DAn1iWxw'),
                  _buildAvatar('https://lh3.googleusercontent.com/aida-public/AB6AXuAeQhbU6gfBeTWIX9iUBzG-5dllpQxVmJSxjhvSeTI0uFuRuzPk2Y9flZu7TibFTMfCEZku0hpU0u_JOTHcoz6WVVqbk54ckYSjVhDgm3vuX8XW_R4I4khVkmMLuLWcE5XYJkLUfTjJ4aBXQN72LxXjQ9lkawtx-X3SoLoO2wbwfKQSSeD0F6f-m7TnvMQMwr7z-3zvVYDNZblePKzWnVp2lYqq0Qqv7PmHdprcgIYSzisIm9iMxLwIUA', offset: -10),
                  _buildAvatar('https://lh3.googleusercontent.com/aida-public/AB6AXuDVW09SPcBh7bBK7MON9fIxgwpzAIxrHsNRGxFbx_w7bDL2UpQ516Mg6WDqzU0CBsw7ucQ-QIoW3fXs58aaSUZSjzDsKUhQWPk47vqQb_js-M8vNOsPI0eFnprZL_V29gGlkwNwYyTrJr80hojrjhK_Odn8POVrcL-E433HzKr8Ta56ky32awz4n2LRyAERaL210cf1NZ4RXEOnblLP_Op1VrNJaiNqyudgsLJpBjwytgIxzG-kgHJBfA', offset: -20),
                  _buildAvatar('https://lh3.googleusercontent.com/aida-public/AB6AXuBFYN8JITlt_82b9B86cyGPOjNc_Ise7pBLVati9TiVZvse0ANLR8_qnAc79pQ6BK985saliegrinBVqRsjZjoiGnuBUzLpJc53X_-6YfzsQH-_1cE8VCniEFxYzzCd9LYBXTwj3-AS-V4X4oAKVXmXko6mNPZi5WhHYSGyYe8k5lLK8W8C6LB_YLUV5qAp6c_6mUWRRSOiQluNtup0u11mELr81UvXMMiYAavtwxxhtrBUpONFuF6TUw', offset: -30),
                  Transform.translate(
                    offset: const Offset(-24, 0),
                    child: const Text('4 members active', style: TextStyle(fontSize: 10, color: AppTheme.textMuted)),
                  ),
                ],
              ),
              const Row(
                children: [
                  Icon(Icons.eco, color: AppTheme.secondary, size: 16),
                  SizedBox(width: 4),
                  Text('RosieBot thriving', style: TextStyle(color: AppTheme.secondary, fontSize: 10)),
                ],
              )
            ],
          )
        ],
      ),
    );
  }

  Widget _buildAvatar(String url, {double offset = 0}) {
    return Transform.translate(
      offset: Offset(offset, 0),
      child: Container(
        width: 28,
        height: 28,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: AppTheme.surfaceContainer, width: 2),
          image: DecorationImage(image: NetworkImage(url), fit: BoxFit.cover),
        ),
      ),
    );
  }

  Widget _buildFilterPills() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _buildPill('All Chores', isActive: true),
          const SizedBox(width: 8),
          _buildPill('Assigned to Me'),
          const SizedBox(width: 8),
          _buildPill('High Priority'),
          const SizedBox(width: 8),
          _buildPill('By Room'),
        ],
      ),
    );
  }

  Widget _buildPill(String label, {bool isActive = false}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: isActive ? AppTheme.primary : AppTheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(20),
        border: isActive ? null : Border.all(color: AppTheme.borderLight),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: isActive ? AppTheme.onPrimary : AppTheme.textSecondary,
          fontWeight: FontWeight.bold,
          fontSize: 14,
        ),
      ),
    );
  }

  Widget _buildKanbanTabs() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        children: [
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                color: AppTheme.surfaceContainer,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.borderLight),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('To Do', style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold)),
                  const SizedBox(width: 6),
                  Container(
                    width: 20,
                    height: 20,
                    decoration: BoxDecoration(color: AppTheme.primary.withValues(alpha: 0.2), shape: BoxShape.circle),
                    child: const Center(child: Text('4', style: TextStyle(color: AppTheme.primary, fontSize: 11, fontWeight: FontWeight.bold))),
                  )
                ],
              ),
            ),
          ),
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('In Progress', style: TextStyle(color: AppTheme.textSecondary)),
                const SizedBox(width: 6),
                Container(
                  width: 20,
                  height: 20,
                  decoration: const BoxDecoration(color: AppTheme.surfaceContainerHigh, shape: BoxShape.circle),
                  child: const Center(child: Text('2', style: TextStyle(color: AppTheme.textMuted, fontSize: 11))),
                )
              ],
            ),
          ),
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('Done', style: TextStyle(color: AppTheme.textSecondary)),
                const SizedBox(width: 6),
                Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(color: AppTheme.secondary.withValues(alpha: 0.2), shape: BoxShape.circle),
                  child: const Center(child: Text('6', style: TextStyle(color: AppTheme.secondary, fontSize: 11, fontWeight: FontWeight.bold))),
                )
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChoreCards() {
    return Column(
      children: [
        _buildChoreCard(
          tag1: 'Weekly',
          points: '3 pts',
          tag2: 'Kitchen',
          tag2Color: const Color(0xFF58292B),
          tag2TextColor: const Color(0xFFFFDAD8),
          title: 'Deep clean refrigerator & organize pantry',
          subtitle: 'Discard expired spreads, wipe crisper drawers, restock dry jars.',
          personAvatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD7Cs6A0WI-uWFwGw3n9rdaQs04ni3vOuhW_KxBV31mL116aDig99n6ZEMwQcguP7l2BjT2i9obkpApO0PtMhCwrpQGKWjklOhscPWiYZ24VECyN8Ols4R5I30iMmHXgPO51-EWzMkzu04oM6NlKZRRuaDtK-wPs_xFRf66kekuJ-UWm-fAIWYG4T_wHKwMfrDlicTGxRNnffXuYF-SpKACPXMFWD42MedetEOBMOfV1aQi5jHvpYdcVQ',
          personName: 'Maya',
          timeDesc: 'Sat 11:00 AM',
          stripeColor: AppTheme.primary,
        ),
        const SizedBox(height: 12),
        _buildChoreCard(
          tag1: 'RosieBot Habit',
          tag1Icon: Icons.yard_rounded,
          points: '1 pt',
          title: 'Water indoor plants & mist ferns',
          subtitle: 'Monstera moisture check + gentle neem leaf dusting.',
          personAvatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCLqspUp1pSAL0fWHkUHhPbNntXFKns-7wg0SiDQYu2yjDgm0k40n7wcAKCEGemzb-CdFDcatwQhn8Vhi9upRVHIWRU7sY_Zcc4FyBRbnaDtgrLlysHwwoRm34f6CNzw5KaxZCk7790hh0epIMLOrdQngMm0t9P4mzDb3aqi_9VrzfrzhCFnrcNSBGZIfv7xXXE5qodYg006RHh7t9UQqmkgm9sOKFZFw8SSm3OYELWIdESNvMnD2cEZg',
          personName: 'Alex',
          timeDesc: 'Today 5:00 PM',
          stripeColor: AppTheme.secondary,
          timeIcon: Icons.alarm,
          timeColor: AppTheme.primary,
          primaryActionBtn: false,
        ),
        const SizedBox(height: 12),
        _buildChoreCard(
          tag1: 'Supplies',
          tag1Color: AppTheme.surfaceContainerHigh,
          tag1TextColor: AppTheme.textSecondary,
          points: '1 pt',
          tag2: 'Bath & Linen',
          tag2Color: AppTheme.secondaryContainer,
          tag2TextColor: const Color(0xFFC5E9F1),
          title: 'Restock bathroom essentials & paper goods',
          subtitle: 'Replenish cedar soap bars, eucalyptus hand spray, and bamboo rolls.',
          personAvatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDJ7Gm2Mju7Xc7hTB8wZszAzv4TUfF1Teepa-y5fMX52qj9Km_EiV7OD0C5VeTrqkgW2yZzInJwehIs0_dTeXeAcsVWVsiIuM3AaipTOQDI6eOPl3fiLBcxj8AnGhvIED5WHhhhJDriNPkA8cT5hdd0tlr4iaEk9oNxWZLh7xhneuK6yGChP0yiDF5A1S-8__L_fPszdtTiiPgwNJo6altvTVYIehzxa0JHuL6-wuB4gfGYPCYYChi8WA',
          personName: 'Liam',
          timeDesc: 'Due Sunday',
          stripeColor: Colors.transparent,
          timeIcon: Icons.calendar_today,
          iconOnlyBtn: true,
        ),
        const SizedBox(height: 12),
        _buildChoreCard(
          tag1: 'Daily',
          points: '1 pt',
          tag2: 'Patio',
          tag2Color: const Color(0xFF58292B),
          tag2TextColor: const Color(0xFFFFDAD8),
          title: 'Recycling & compost bin sorting',
          subtitle: 'Move organic scrap tub to garden tumbler & bundle cardboard.',
          personAvatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuANd6ZBEeSIsnpS4z9RVQ6D9IXya0q09X1SPK0VMStQuZMz8wc6gbW2RJo2J-RaqFVDeZ_zs1EtWBJtsceaHb1sq68fRvK_v1RGvSWoHMwOpG1mFgqJfb0i1XVOxvuzIlvBTy3X9k8GCbDg71x365xo58hj6QZQYpHMfIOz5FCdvggCETzVAovgb8Fr9_hsyknolgaXwMsRuDUBPasU916XvLMw0NVG5J5zGa33SJS13LUqiLZN9v47Mw',
          personName: 'Dev',
          timeDesc: 'Today 8:00 PM',
          stripeColor: Colors.transparent,
          timeIcon: Icons.alarm,
          timeColor: AppTheme.primary,
          iconOnlyBtn: true,
        ),
      ],
    );
  }

  Widget _buildChoreCard({
    required String tag1,
    IconData? tag1Icon,
    Color? tag1Color,
    Color? tag1TextColor,
    required String points,
    String? tag2,
    Color? tag2Color,
    Color? tag2TextColor,
    required String title,
    required String subtitle,
    required String personAvatar,
    required String personName,
    required String timeDesc,
    IconData timeIcon = Icons.schedule,
    Color? timeColor,
    required Color stripeColor,
    bool primaryActionBtn = true,
    bool iconOnlyBtn = false,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Stack(
        children: [
          if (stripeColor != Colors.transparent)
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: stripeColor,
                  borderRadius: const BorderRadius.only(topLeft: Radius.circular(12), bottomLeft: Radius.circular(12)),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Wrap(
                      spacing: 8,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: tag1Color ?? AppTheme.surfaceContainerHigh,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppTheme.borderLight),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (tag1Icon != null) ...[
                                Icon(tag1Icon, size: 12, color: tag1TextColor ?? AppTheme.primary),
                                const SizedBox(width: 4),
                              ],
                              Text(tag1, style: TextStyle(color: tag1TextColor ?? AppTheme.primary, fontSize: 10, fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppTheme.surfaceContainerHigh,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.local_fire_department, size: 12, color: AppTheme.primary),
                              const SizedBox(width: 4),
                              Text(points, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10)),
                            ],
                          ),
                        ),
                        if (tag2 != null)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: tag2Color ?? AppTheme.surfaceContainerHigh,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(tag2, style: TextStyle(color: tag2TextColor ?? AppTheme.textSecondary, fontSize: 10, fontWeight: FontWeight.bold)),
                          ),
                      ],
                    ),
                    const Icon(Icons.more_horiz, color: AppTheme.textMuted, size: 20),
                  ],
                ),
                const SizedBox(height: 12),
                Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                const SizedBox(height: 4),
                Text(subtitle, style: const TextStyle(fontSize: 13, color: AppTheme.textMuted)),
                const SizedBox(height: 16),
                const Divider(height: 1),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 14,
                          backgroundImage: NetworkImage(personAvatar),
                        ),
                        const SizedBox(width: 8),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(personName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                            Row(
                              children: [
                                Icon(timeIcon, size: 12, color: timeColor ?? AppTheme.textMuted),
                                const SizedBox(width: 4),
                                Text(timeDesc, style: TextStyle(color: timeColor ?? AppTheme.textMuted, fontSize: 10)),
                              ],
                            )
                          ],
                        )
                      ],
                    ),
                    if (iconOnlyBtn)
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: AppTheme.surfaceContainerHigh,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppTheme.borderLight),
                        ),
                        child: const Icon(Icons.check_circle, color: AppTheme.textMuted, size: 18),
                      )
                    else if (primaryActionBtn)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(
                          color: AppTheme.primary,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Row(
                          children: [
                            Text('Start', style: TextStyle(color: AppTheme.onPrimary, fontWeight: FontWeight.bold, fontSize: 12)),
                            SizedBox(width: 4),
                            Icon(Icons.arrow_forward, size: 14, color: AppTheme.onPrimary),
                          ],
                        ),
                      )
                    else
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(
                          color: AppTheme.surfaceContainerHigh,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppTheme.borderLight),
                        ),
                        child: const Row(
                          children: [
                            Text('Start', style: TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.bold, fontSize: 12)),
                            SizedBox(width: 4),
                            Icon(Icons.play_arrow, size: 14, color: AppTheme.textPrimary),
                          ],
                        ),
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
}
